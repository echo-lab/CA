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
