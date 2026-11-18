import express from "express";
import multer from "multer";
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import OpenAI from "openai";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const isPdf =
      file.mimetype === "application/pdf" ||
      file.originalname.toLowerCase().endsWith(".pdf");

    cb(isPdf ? null : new Error("Le fichier doit être un PDF."), isPdf);
  }
});

app.use(express.json({ limit: "1mb" }));

app.get("/", (_req, res) =>
  res.sendFile(path.join(__dirname, "index.html"))
);

app.get("/health", (_req, res) => res.json({ ok: true }));

const client = process.env.GEMINI_API_KEY
  ? new OpenAI({
      apiKey: process.env.GEMINI_API_KEY,
      baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
      timeout: 60000,
      maxRetries: 1
    })
  : null;

const model = process.env.GEMINI_MODEL || "gemini-3.8-flash";

function requireAI(_req, res, next) {
  if (!client) {
    return res.status(503).json({
      error: "Le service Gemini n'est pas configuré. Ajoutez GEMINI_API_KEY dans Render."
    });
  }
  next();
}

function cleanText(value, max = 14000) {
  return String(value || "")
    .replace(/\u0000/g, "")
    .trim()
    .slice(0, max);
}

function logTiming(label, startedAt) {
  console.log(`[TIMING] ${label}: ${Date.now() - startedAt} ms`);
}

// EXTRACTION DU CV
app.post("/api/parse-cv", upload.single("cv"), async (req, res) => {
  const startedAt = Date.now();

  try {
    if (!req.file) {
      return res.status(400).json({
        error: "Aucun PDF reçu. Sélectionnez un fichier PDF puis réessayez."
      });
    }

    const parsed = await pdfParse(req.file.buffer);
    const text = cleanText(parsed.text, 16000);

    if (!text) {
      return res.status(422).json({
        error: "Aucun texte détecté. Ce PDF est peut-être un scan nécessitant un OCR."
      });
    }

    logTiming("PDF extraction", startedAt);

    res.json({
      text,
      pages: parsed.numpages,
      filename: req.file.originalname
    });

  } catch (err) {
    console.error("PDF parse error:", err);

    res.status(422).json({
      error: "Impossible de lire ce PDF. Vérifiez qu'il n'est pas protégé ou endommagé."
    });
  }
});

// ANALYSE DU CV ET PREMIÈRE QUESTION EN UN SEUL APPEL GEMINI
app.post("/api/start-interview", requireAI, async (req, res) => {
  const startedAt = Date.now();

  try {
    const cv = cleanText(req.body.cv, 14000);
    const job = cleanText(req.body.job, 300);
    const difficulty = cleanText(
      req.body.difficulty || "Intermédiaire",
      40
    );
    const recruiter = cleanText(req.body.recruiter, 100);

    if (!cv || !job) {
      return res.status(400).json({
        error: "CV et poste visé obligatoires."
      });
    }

    const response = await client.chat.completions.create({
      model,
      response_format: { type: "json_object" },
      max_tokens: 650,
      temperature: 0.2,

      messages: [
        {
          role: "system",
          content: `Tu es un recruteur français.

Prépare le début d'un entretien pour le poste : ${job}.
Niveau : ${difficulty}.
Profil recruteur : ${recruiter}.

Analyse uniquement les informations du CV.
N'invente aucune expérience.

Réponds avec un JSON concis contenant :
- analysis : summary, strengths (3 maximum),
  gaps (3 maximum), questions (3 maximum),
  roleFit, pointsToVerify (3 maximum).
- firstQuestion : une question orale d'ouverture
  personnalisée de 15 à 25 mots.

Format :
{"analysis":{"summary":"","strengths":[],"gaps":[],"questions":[],"roleFit":"","pointsToVerify":[]},"firstQuestion":""}`
        },
        {
          role: "user",
          content: `CV :\n${cv}`
        }
      ]
    });

    const result = JSON.parse(
      response.choices?.[0]?.message?.content || "{}"
    );

    if (!result.analysis || !result.firstQuestion) {
      throw new Error("Réponse IA incomplète.");
    }

    logTiming("Combined CV analysis + first question", startedAt);

    res.json(result);

  } catch (err) {
    console.error("Interview start error:", err);

    res.status(500).json({
      error: "La préparation a échoué. Consultez les logs Render."
    });
  }
});

// GÉNÉRATION DES QUESTIONS SUIVANTES
app.post("/api/next-question", requireAI, async (req, res) => {
  const startedAt = Date.now();

  try {
    const job = cleanText(req.body.job, 250);
    const difficulty = cleanText(
      req.body.difficulty || "Intermédiaire",
      40
    );
    const recruiter = cleanText(req.body.recruiter, 100);

    const analysis =
      req.body.analysis && typeof req.body.analysis === "object"
        ? req.body.analysis
        : {};

    const history = Array.isArray(req.body.history)
      ? req.body.history.slice(-5).map(x => ({
          question: cleanText(x.question, 400),
          answer: cleanText(x.answer, 1200)
        }))
      : [];

    const response = await client.chat.completions.create({
      model,
      response_format: { type: "json_object" },
      max_tokens: 220,
      temperature: 0.5,

      messages: [
        {
          role: "system",
          content: `Tu es un recruteur français pour le poste ${job}.
Niveau : ${difficulty}.
Profil : ${recruiter}.

Pose UNE seule question orale, naturelle et courte
(10 à 25 mots).

Appuie-toi sur l'analyse du CV et les réponses précédentes.
Fais progresser l'entretien.
Varie les thèmes et rebondis sur la dernière réponse.
Ne donne aucun conseil ni évaluation.

JSON strict :
{"question":"...","kind":"...","isFinal":false}.`
        },
        {
          role: "user",
          content: `ANALYSE DU CV : ${JSON.stringify(analysis)}
DERNIÈRES QUESTIONS/RÉPONSES : ${JSON.stringify(history)}
Question ${Number(req.body.questionNumber) || 2}
sur ${Number(req.body.totalQuestions) || 10}.`
        }
      ]
    });

    const result = JSON.parse(
      response.choices?.[0]?.message?.content || "{}"
    );

    if (!result.question) {
      throw new Error("Question vide reçue de Gemini.");
    }

    logTiming("Next interview question", startedAt);
    res.json(result);

  } catch (err) {
    console.error("Next question error:", err);

    res.status(500).json({
      error: "Impossible de générer la prochaine question. Consultez les logs Render."
    });
  }
});

// DÉBRIEF FINAL
app.post("/api/debrief", requireAI, async (req, res) => {
  const startedAt = Date.now();

  try {
    const cv = cleanText(req.body.cv, 12000);
    const job = cleanText(req.body.job, 250);
    const difficulty = cleanText(
      req.body.difficulty || "Intermédiaire",
      40
    );
    const recruiter = cleanText(req.body.recruiter, 100);

    const history = Array.isArray(req.body.history)
      ? req.body.history.slice(0, 12)
      : [];

    const analysis = req.body.analysis || {};

    const response = await client.chat.completions.create({
      model,
      response_format: { type: "json_object" },
      max_tokens: 1800,
      temperature: 0.2,

      messages: [
        {
          role: "system",
          content: `Tu es un recruteur exigeant.

Évalue l'entretien sur 9 critères notés sur 20 :
accueil, présentation, parcours, auto-évaluation,
motivation, STAR, technique, questions pièges,
questions candidat.

Le total est sur 180.

Base-toi uniquement sur les réponses.
Si un thème n'a pas été abordé, note prudemment.

Donne :
- Un verdict : Recruté, Short-listé ou Refusé.
- 3 réponses faibles avec reformulations.
- 2 meilleurs moments.
- 3 priorités.
- Une faille CV et comment la défendre.
- Une impression en 3 adjectifs.

N'invente rien.

JSON avec clés :
scores (array {criterion,score,good,improve}),
total, verdict, verdictReason,
weakAnswers (array {original,better}),
bestMoments, impression,
priorities (array {axis,method}),
cvGap, nextObjective.`
        },
        {
          role: "user",
          content: `POSTE : ${job}.
NIVEAU : ${difficulty}.
RECRUTEUR : ${recruiter}.

CV :
${cv}

ANALYSE :
${JSON.stringify(analysis)}

ENTRETIEN :
${JSON.stringify(history)}`
        }
      ]
    });

    const result = JSON.parse(
      response.choices?.[0]?.message?.content || "{}"
    );

    logTiming("Interview debrief", startedAt);
    res.json(result);

  } catch (err) {
    console.error("Debrief error:", err);

    res.status(500).json({
      error: "Le débrief IA n'a pas pu être généré. Consultez les logs Render."
    });
  }
});

// GESTION DES ERREURS
app.use((err, _req, res, _next) => {
  if (
    err instanceof multer.MulterError &&
    err.code === "LIMIT_FILE_SIZE"
  ) {
    return res.status(413).json({
      error: "Le PDF dépasse la limite de 10 Mo."
    });
  }

  res.status(400).json({
    error: err.message || "Requête invalide."
  });
});

const port = process.env.PORT || 3000;

app.listen(port, () => {
  console.log(
    `Training Coach IA démarré sur le port ${port} · modèle ${model}`
  );
});
