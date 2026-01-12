import sys
from langchain_openai import OpenAIEmbeddings
from langchain_community.vectorstores import Chroma

EMBEDDING_MODEL = "text-embedding-3-small"
PERSIST_DIR = "chroma_book_db"

def main():
    if len(sys.argv) < 2:
        print("Usage: python query_book.py \"your question or prompt\" [k]")
        sys.exit(1)
    query = sys.argv[1]
    k = int(sys.argv[2]) if len(sys.argv) > 2 else 6

    embeddings = OpenAIEmbeddings(model=EMBEDDING_MODEL)
    db = Chroma(
        persist_directory=PERSIST_DIR,
        collection_name="children_book",
        embedding_function=embeddings,
    )

    results = db.similarity_search(query, k=k)
    print(f"Top {k} snippets:\n")
    for i, d in enumerate(results, 1):
        meta = d.metadata or {}
        loc = []
        if "source" in meta: loc.append(str(meta["source"]))
        if "page" in meta:   loc.append(f"p.{meta['page']}")
        loc_s = " — " + ", ".join(loc) if loc else ""
        print(f"[{i}]{loc_s}\n{d.page_content}\n")

if __name__ == "__main__":
    main()
