# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) (or [oxc](https://oxc.rs) when used in [rolldown-vite](https://vite.dev/guide/rolldown)) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

# ---- RAG Tool ----

# RAG-Enabled Realtime API Setup

## Overview
This setup uses Python FastAPI with ChromaDB for RAG (Retrieval-Augmented Generation) to provide document-based context to the OpenAI Realtime API.

## How It Works
1. **Documents are indexed** using `ragtool.py` into ChromaDB vector database
2. **When users ask questions**, the frontend queries the RAG API to get relevant context
3. **Context is included** in the message sent to OpenAI Realtime API
4. **AI answers based on** the provided document context

## Setup Steps

### 1. Index Your Documents (One-time setup)
```bash
# Activate the virtual environment
source venv/bin/activate

# Index documents from a folder or file
cd server
python ragtool.py data/

# This creates a ChromaDB database in server/chroma_book_db/
```

### 2. Start the Python FastAPI Server
```bash
# Option A: Using npm script (recommended)
npm run server:dev

# Option B: Manual start
source venv/bin/activate
cd server
python -m uvicorn app:app --reload --port 8787
```

### 3. Start the Frontend
```bash
# In a new terminal
npm run dev
```

### 4. Test the Application
1. Open http://localhost:5173 in your browser
2. Click "Start Connection"
3. Type a question related to your indexed documents
4. The AI will answer based on the document context!

## API Endpoints

### `/api/realtime-token` (GET)
Returns a short-lived OpenAI Realtime API client secret

### `/api/rag` (POST)
Retrieves relevant document snippets
```json
{
  "query": "What is the main topic?",
  "k": 3
}
```

### `/health` (GET)
Health check endpoint

## Configuration

Edit `.env` file:
- `OPENAI_API_KEY`: Your OpenAI API key
- `OPENAI_EMBED_MODEL`: Embedding model (default: text-embedding-3-small)
- `CHROMA_DIR`: ChromaDB directory (default: chroma_book_db)
- `OPENAI_REALTIME_MODEL`: Realtime model (default: gpt-realtime)

## Troubleshooting

### "Chroma directory not found" error
Run the indexing script first: `python ragtool.py data/`

### "OPENAI_API_KEY not found" error
Ensure `.env` file exists in the project root with your API key

### No context in responses
Check the server logs to see if RAG queries are succeeding

