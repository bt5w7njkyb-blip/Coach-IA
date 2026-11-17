# Interview Studio Pro

Application web de simulation d'entretien avec import PDF robuste, analyse de CV par IA, questions adaptatives et débrief détaillé.

## Pourquoi cette version corrige l'import PDF
Le navigateur n'essaie plus de lire le PDF via une bibliothèque CDN dans la page. Le fichier est envoyé au serveur local via `multipart/form-data`, contrôlé (PDF uniquement, maximum 10 Mo), puis le texte est extrait avec `pdf-parse`. Cela évite plusieurs causes fréquentes d'échec : CDN indisponible, type MIME vide, navigateur ne lisant pas le document. Les PDF scannés sans couche texte nécessitent toujours un OCR.

## Installation locale
Prérequis : Node.js 18 ou plus récent.

```bash
npm install
cp .env.example .env
```

Ouvrez `.env` et ajoutez votre clé API :
```env
OPENAI_API_KEY=votre_cle_api
OPENAI_MODEL=gpt-4o-mini
PORT=3000
```

Puis lancez :
```bash
npm start
```
Ouvrez http://localhost:3000

## Fonctions
- Import PDF par clic ou glisser-déposer, avec erreurs explicites.
- Extraction PDF côté serveur et refus des fichiers vides/scannés sans texte.
- Analyse IA du CV : points forts, zones d'ombre, adéquation au poste et questions à creuser.
- Entretien vocal : lecture des questions et dictée si le navigateur prend en charge Web Speech API.
- Questions adaptatives : le modèle tient compte du CV, du poste, de la difficulté, du recruteur et des réponses précédentes.
- Débrief IA : 9 critères sur 20, total sur 180, verdict, reformulations, meilleurs moments et axes prioritaires.
- Historique des scores stocké localement dans le navigateur.

## Publier sur GitHub
Poussez le dossier complet dans un repository GitHub. **Ne publiez jamais `.env`** : il est ignoré par `.gitignore`. Le dépôt ne contient que `.env.example`, sans clé secrète.

## Déploiement
Il faut un hébergement Node.js (Render, Railway, Fly.io ou serveur équivalent), pas seulement GitHub Pages. Configurez `OPENAI_API_KEY` dans les variables d'environnement de l'hébergeur. GitHub Pages ne peut pas exécuter `server.js` et ne doit jamais recevoir une clé API.

## Confidentialité et limites
Le CV et les réponses sont transmis à votre serveur puis au fournisseur IA configuré pour l'analyse. Informez les utilisateurs et obtenez leur accord avant de traiter des CV tiers. Cette version n'ajoute pas d'authentification ni de base de données centralisée. Les scores sont des évaluations générées par IA et doivent être utilisés comme entraînement, pas comme décision réelle d'embauche.
