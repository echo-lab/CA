# index_book.py
import os
import sys
from pathlib import Path
from dotenv import load_dotenv

# Load environment variables from parent folder
env_path = Path(__file__).parent.parent / ".env"
load_dotenv(env_path)

# Verify OPENAI_API_KEY is loaded (without logging the raw value)
if os.getenv("OPENAI_API_KEY"):
    print("OPENAI_API_KEY loaded successfully")
else:
    print("WARNING: OPENAI_API_KEY not found in environment")


from langchain_openai import OpenAIEmbeddings
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_community.vectorstores import Chroma
from langchain_community.document_loaders import (
    TextLoader, PyPDFLoader, DirectoryLoader
)

# -------- config --------
EMBEDDING_MODEL = "text-embedding-3-small"  # or "text-embedding-3-large"
CHUNK_SIZE = 800
CHUNK_OVERLAP = 120
PERSIST_DIR = "chroma_book_db"
# ------------------------

def load_docs(input_path: str):
    p = Path(input_path)
    docs = []
    if p.is_dir():
        # load .txt and .pdf from a folder
        for pattern, loader_cls, kwargs in [
            ("**/*.txt", TextLoader, {"encoding": "utf-8"}),
            ("**/*.md",  TextLoader, {"encoding": "utf-8"}),
            ("**/*.pdf", PyPDFLoader, {}),
        ]:
            dl = DirectoryLoader(str(p), glob=pattern, loader_cls=loader_cls, loader_kwargs=kwargs)
            docs.extend(dl.load())
    else:
        # single file
        if p.suffix.lower() in [".txt", ".md"]:
            docs = TextLoader(str(p), encoding="utf-8").load()
        elif p.suffix.lower() == ".pdf":
            docs = PyPDFLoader(str(p)).load()
        else:
            raise ValueError("Unsupported file type. Use .pdf, .txt, or a directory.")
    return docs

def main():
    if len(sys.argv) < 2:
        print("Usage: python index_book.py <book.pdf|book.txt|folder>")
        sys.exit(1)

    input_path = sys.argv[1]
    raw_docs = load_docs(input_path)
    if not raw_docs:
        raise RuntimeError("No documents found.")

    # Chunk with LangChain
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=CHUNK_SIZE,
        chunk_overlap=CHUNK_OVERLAP,
        add_start_index=True,
    )
    chunks = splitter.split_documents(raw_docs)

    # OpenAI embeddings (reads OPENAI_API_KEY from env)
    embeddings = OpenAIEmbeddings(model=EMBEDDING_MODEL)

    # Store in Chroma (automatically persisted to disk)
    vs = Chroma.from_documents(
        documents=chunks,
        embedding=embeddings,
        persist_directory=PERSIST_DIR,
        collection_name="children_book",
    )
    print(f"Indexed {len(chunks)} chunks → {PERSIST_DIR}")

if __name__ == "__main__":
    main()
