"""
FastAPI server merging OpenAI Realtime token issuance + ChromaDB RAG retrieval.
Run: uvicorn app:app --reload --port 8787
"""
import os
from pathlib import Path
from typing import Optional, List, Dict, Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from dotenv import load_dotenv
import httpx

from langchain_openai import OpenAIEmbeddings
from langchain_community.vectorstores import Chroma
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_community.document_loaders import (
    TextLoader, PyPDFLoader, DirectoryLoader
)
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Load environment variables
env_path = Path(__file__).parent.parent / ".env"
load_dotenv(env_path)

# Configuration
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
OPENAI_EMBED_MODEL = os.getenv("OPENAI_EMBED_MODEL", "text-embedding-3-small")
CHROMA_DIR = os.getenv("CHROMA_DIR", "chroma_book_db")
OPENAI_REALTIME_MODEL = os.getenv("OPENAI_REALTIME_MODEL", "gpt-realtime")
OPENAI_REALTIME_VOICE = os.getenv("OPENAI_REALTIME_VOICE", "marin")
REALTIME_TOKEN_TTL_SECONDS = int(os.getenv("REALTIME_TOKEN_TTL_SECONDS", "60"))

if not OPENAI_API_KEY:
    raise RuntimeError("OPENAI_API_KEY environment variable is required")

# Initialize FastAPI
app = FastAPI(title="Realtime RAG Server", version="1.0.0")

# CORS for local development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:*", "http://127.0.0.1:*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ============================================================================
# Pydantic models
# ============================================================================
class IndexRequest(BaseModel):
    input_path: str = Field(..., description="Path to file or directory to index")
    chunk_size: Optional[int] = Field(800, ge=100, le=2000, description="Size of text chunks")
    chunk_overlap: Optional[int] = Field(120, ge=0, le=500, description="Overlap between chunks")


class IndexResponse(BaseModel):
    status: str
    message: str
    chunks_indexed: int
    persist_directory: str


class RAGRequest(BaseModel):
    query: str = Field(..., min_length=1, description="Search query")
    k: Optional[int] = Field(6, ge=1, le=20, description="Number of results")

class RAGResult(BaseModel):
    id: Optional[str] = None
    text: str
    page: Optional[int] = None
    source: Optional[str] = None
    score: Optional[float] = None

class RAGResponse(BaseModel):
    context: List[RAGResult]

# ============================================================================
# RAG retrieval utility
# ============================================================================
def load_documents(input_path: str):
    """Load documents from a file or directory."""
    p = Path(input_path)
    docs = []
    
    if not p.exists():
        raise FileNotFoundError(f"Path '{input_path}' does not exist")
    
    if p.is_dir():
        # Load .txt, .md, and .pdf from a folder
        for pattern, loader_cls, kwargs in [
            ("**/*.txt", TextLoader, {"encoding": "utf-8"}),
            ("**/*.md", TextLoader, {"encoding": "utf-8"}),
            ("**/*.pdf", PyPDFLoader, {}),
        ]:
            dl = DirectoryLoader(
                str(p), 
                glob=pattern, 
                loader_cls=loader_cls, 
                loader_kwargs=kwargs,
                show_progress=True
            )
            docs.extend(dl.load())
    else:
        # Single file
        if p.suffix.lower() in [".txt", ".md"]:
            docs = TextLoader(str(p), encoding="utf-8").load()
        elif p.suffix.lower() == ".pdf":
            docs = PyPDFLoader(str(p)).load()
        else:
            raise ValueError(f"Unsupported file type: {p.suffix}. Use .pdf, .txt, .md, or a directory.")
    
    return docs


def index_documents(input_path: str, chunk_size: int = 800, chunk_overlap: int = 120) -> int:
    """
    Index documents into ChromaDB vector store.
    Returns the number of chunks indexed.
    """
    # Load documents
    logger.info(f"Loading documents from: {input_path}")
    raw_docs = load_documents(input_path)
    
    if not raw_docs:
        raise RuntimeError("No documents found to index")
    
    logger.info(f"Loaded {len(raw_docs)} documents")
    
    # Split into chunks
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=chunk_size,
        chunk_overlap=chunk_overlap,
        add_start_index=True,
    )
    chunks = splitter.split_documents(raw_docs)
    logger.info(f"Split into {len(chunks)} chunks")
    
    # Create embeddings
    embeddings = OpenAIEmbeddings(model=OPENAI_EMBED_MODEL)
    
    # Store in ChromaDB
    chroma_path = Path(__file__).parent / CHROMA_DIR
    vs = Chroma.from_documents(
        documents=chunks,
        embedding=embeddings,
        persist_directory=str(chroma_path),
        collection_name="children_book",
    )
    
    logger.info(f"Indexed {len(chunks)} chunks to {CHROMA_DIR}")
    return len(chunks)


def get_chroma_db() -> Chroma:
    """Load ChromaDB instance from disk."""
    chroma_path = Path(__file__).parent / CHROMA_DIR
    if not chroma_path.exists():
        raise FileNotFoundError(
            f"Chroma directory '{CHROMA_DIR}' not found. Run your indexer script first."
        )
    
    embeddings = OpenAIEmbeddings(model=OPENAI_EMBED_MODEL)
    db = Chroma(
        persist_directory=str(chroma_path),
        collection_name="children_book",
        embedding_function=embeddings,
    )
    return db


def retrieve_snippets(query: str, k: int = 6) -> List[RAGResult]:
    """Retrieve top-k similar documents from ChromaDB."""
    db = get_chroma_db()
    results = db.similarity_search_with_score(query, k=k)
    
    snippets = []
    for i, (doc, score) in enumerate(results):
        meta = doc.metadata or {}
        text = doc.page_content
        
        # Trim overly long texts
        if len(text) > 1200:
            text = text[:1200] + "..."
        
        snippets.append(
            RAGResult(
                id=f"doc_{i}",
                text=text,
                page=meta.get("page"),
                source=meta.get("source"),
                score=float(score) if score is not None else None,
            )
        )
    
    return snippets


# ============================================================================
# API endpoints
# ============================================================================
@app.get("/api/realtime-token")
async def get_realtime_token():
    """
    Exchange server OPENAI_API_KEY for a short-lived client secret.
    Returns the full JSON response from OpenAI.
    """
    url = "https://api.openai.com/v1/realtime/client_secrets"
    headers = {
        "Authorization": f"Bearer {OPENAI_API_KEY}",
        "Content-Type": "application/json",
    }
    payload = {
        "session": {
            "type": "realtime",
            "model": "gpt-realtime",
            "audio": {
                "output": {
                    "voice": "marin",
                },
            },
        }
    }
    
    async with httpx.AsyncClient() as client:
        try:
            logger.info("Fetching realtime token from OpenAI...")
            resp = await client.post(url, json=payload, headers=headers, timeout=10.0)
            resp.raise_for_status()
            return resp.json()
        except httpx.HTTPStatusError as e:
            error_text = e.response.text
            raise HTTPException(
                status_code=e.response.status_code,
                detail=f"OpenAI error: {error_text}",
            )
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Request failed: {str(e)}")

@app.post("/api/rag", response_model=RAGResponse)
async def rag_query(req: RAGRequest):
    """
    Retrieve top-k snippets from ChromaDB based on similarity to query.
    """
    try:
        logger.info(f"Received RAG query request: {req.query}")
        snippets = retrieve_snippets(req.query, k=req.k)
        return RAGResponse(context=snippets)
    except FileNotFoundError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"RAG query failed: {str(e)}")

@app.post("/api/index", response_model=IndexResponse)
async def index_documents_endpoint(req: IndexRequest):
    """
    Index documents from a file or directory into ChromaDB.
    This creates embeddings and stores them for RAG queries.
    
    Example:
    POST /api/index
    {
        "input_path": "/path/to/documents",
        "chunk_size": 800,
        "chunk_overlap": 120
    }
    """
    try:
        logger.info(f"Starting indexing for: {req.input_path}")
        
        # Resolve path (handle relative paths from server directory)
        input_path = req.input_path
        if not os.path.isabs(input_path):
            # If relative path, resolve from server directory
            input_path = str(Path(__file__).parent / input_path)
        
        # Run indexing
        chunks_count = index_documents(
            input_path=input_path,
            chunk_size=req.chunk_size,
            chunk_overlap=req.chunk_overlap
        )
        
        return IndexResponse(
            status="success",
            message=f"Successfully indexed documents from {req.input_path}",
            chunks_indexed=chunks_count,
            persist_directory=CHROMA_DIR
        )
        
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Indexing failed: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Indexing failed: {str(e)}")


@app.get("/api/index-info")
async def get_index_info():
    """
    Get information about the current ChromaDB index.
    Returns document count and configuration details.
    """
    try:
        chroma_path = Path(__file__).parent / CHROMA_DIR
        
        if not chroma_path.exists():
            return {
                "status": "not_indexed",
                "message": "No index found. Use POST /api/index to create one.",
                "database": CHROMA_DIR,
                "exists": False
            }
        
        db = get_chroma_db()
        collection = db._collection
        count = collection.count()
        
        return {
            "status": "ok",
            "database": CHROMA_DIR,
            "collection_name": "children_book",
            "document_count": count,
            "embedding_model": OPENAI_EMBED_MODEL,
            "exists": True
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get index info: {str(e)}")


@app.get("/health")
async def health():
    """Health check endpoint."""
    return {"status": "ok", "service": "realtime-rag-server"}


# ============================================================================
# Main
# ============================================================================
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="0.0.0.0", port=8787, reload=True)
