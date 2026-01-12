# API Indexing Endpoint Usage Guide

## Endpoint: POST /api/index

### Purpose
Vectorize and index documents into ChromaDB for RAG (Retrieval-Augmented Generation).

## Request Format

### Basic Request
```json
POST http://localhost:8787/api/index
Content-Type: application/json

{
  "input_path": "data/"
}
```

### Advanced Request (with custom parameters)
```json
POST http://localhost:8787/api/index
Content-Type: application/json

{
  "input_path": "data/my_document.pdf",
  "chunk_size": 1000,
  "chunk_overlap": 150
}
```

## Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `input_path` | string | Yes | - | Path to file or directory to index. Can be absolute or relative to server directory |
| `chunk_size` | integer | No | 800 | Size of text chunks (100-2000) |
| `chunk_overlap` | integer | No | 120 | Overlap between chunks (0-500) |

## Supported File Types
- `.txt` - Plain text files
- `.md` - Markdown files
- `.pdf` - PDF documents
- Directories containing any of the above

## Response Format

### Success Response (200)
```json
{
  "status": "success",
  "message": "Successfully indexed documents from data/",
  "chunks_indexed": 142,
  "persist_directory": "chroma_book_db"
}
```

### Error Responses

#### 404 - File Not Found
```json
{
  "detail": "Path 'data/missing.pdf' does not exist"
}
```

#### 400 - Invalid File Type
```json
{
  "detail": "Unsupported file type: .docx. Use .pdf, .txt, .md, or a directory."
}
```

#### 500 - Indexing Error
```json
{
  "detail": "Indexing failed: <error message>"
}
```

## Example Usage

### Using curl
```bash
# Index a directory
curl -X POST http://localhost:8787/api/index \
  -H "Content-Type: application/json" \
  -d '{"input_path": "data/"}'

# Index a single PDF
curl -X POST http://localhost:8787/api/index \
  -H "Content-Type: application/json" \
  -d '{"input_path": "/absolute/path/to/document.pdf"}'
```

### Using JavaScript/Fetch
```javascript
const response = await fetch('http://localhost:8787/api/index', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    input_path: 'data/',
    chunk_size: 800,
    chunk_overlap: 120
  })
});

const result = await response.json();
console.log(`Indexed ${result.chunks_indexed} chunks`);
```

### Using Python
```python
import requests

response = requests.post(
    'http://localhost:8787/api/index',
    json={
        'input_path': 'data/',
        'chunk_size': 800,
        'chunk_overlap': 120
    }
)

result = response.json()
print(f"Status: {result['status']}")
print(f"Indexed {result['chunks_indexed']} chunks")
```

## Check Index Status

### GET /api/index-info
Get information about the current index without re-indexing.

```bash
curl http://localhost:8787/api/index-info
```

Response:
```json
{
  "status": "ok",
  "database": "chroma_book_db",
  "collection_name": "children_book",
  "document_count": 142,
  "embedding_model": "text-embedding-3-small",
  "exists": true
}
```

## Important Notes

1. **Path Resolution**: 
   - Relative paths are resolved from the `server/` directory
   - Absolute paths work as expected
   - Example: `"data/"` resolves to `server/data/`

2. **Overwriting**: 
   - Running the indexer multiple times will add to the existing index
   - To start fresh, delete the `chroma_book_db` directory first

3. **Performance**: 
   - Large documents/directories may take time to process
   - The endpoint will block until indexing completes
   - Consider implementing progress tracking for production use

4. **Requirements**:
   - OPENAI_API_KEY must be set in environment
   - Sufficient disk space for vector storage
   - Internet connection for OpenAI API calls

## Workflow

1. **Prepare documents**: Place files in a directory (e.g., `server/data/`)
2. **Call index endpoint**: `POST /api/index` with path
3. **Verify**: Call `GET /api/index-info` to confirm
4. **Query**: Use `POST /api/rag` to retrieve relevant context

## Troubleshooting

### "OPENAI_API_KEY not found"
Ensure `.env` file exists with valid API key

### "No documents found to index"
- Check that files exist in the specified path
- Verify file extensions are supported (.txt, .md, .pdf)

### "Indexing failed"
Check server logs for detailed error messages
