import os
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sentence_transformers import SentenceTransformer
from pydantic import BaseModel
import chromadb
from dotenv import load_dotenv
import google.generativeai as genai
import time

load_dotenv()
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
if GEMINI_API_KEY and GEMINI_API_KEY != "your_real_gemini_api_key_here":
    genai.configure(api_key=GEMINI_API_KEY)

app = FastAPI(title="ZaryahPlus Islamic Knowledge Assistant - RAG Prototype")

# Load embedding model
embedding_model_name = "all-MiniLM-L6-v2"
embedding_model = SentenceTransformer(embedding_model_name)

# Initialize ChromaDB client and collection
chroma_client = chromadb.PersistentClient(path="./chroma_db")
collection_name = "islamic_text_chunks"
collection = chroma_client.get_or_create_collection(name=collection_name)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class QueryRequest(BaseModel):
    question: str

def chunk_text(text: str):
    max_chars = int(os.getenv("MAX_CHARS_PER_CHUNK", 1200))
    chunks = []
    start = 0
    while start < len(text):
        chunks.append(text[start:start+max_chars])
        start += max_chars - 100  # overlap of 100 characters
    return chunks

def generate_embeddings(chunks: list[str]):
    embeddings = embedding_model.encode(chunks).tolist()
    return embeddings

def clear_collection():
    existing = collection.get()
    ids = existing.get("ids", [])
    if ids:
        collection.delete(ids=ids)

def store_chunks(chunks: list[str], embeddings: list[list[float]], filename: str):
    ids = [f"chunk_{i}" for i in range(len(chunks))]
    metadatas = [{"chunk_index": i, "filename": filename, "word_count": len(chunks[i].split())} for i in range(len(chunks))]
    collection.add(
        ids=ids,
        documents=chunks,
        embeddings=embeddings,
        metadatas=metadatas
    )

def retrieve_relevant_chunks(question: str):
    top_k = int(os.getenv("TOP_K", 3))
    count = collection.count()
    if count == 0:
        return []
    
    actual_top_k = min(top_k, count)
    question_embedding = embedding_model.encode([question]).tolist()[0]
    
    results = collection.query(
        query_embeddings=[question_embedding],
        n_results=actual_top_k
    )
    
    documents = results.get("documents", [[]])[0]
    distances = results.get("distances", [[]])[0]
    metadatas = results.get("metadatas", [[]])[0]
    
    sources = []
    for i, doc in enumerate(documents):
        sources.append({
            "source_number": i + 1,
            "text": doc,
            "metadata": metadatas[i] if metadatas and i < len(metadatas) else {},
            "distance": distances[i] if distances and i < len(distances) else None
        })
        
    return sources

def generate_llm_answer(question: str, sources: list[dict]):
    if not GEMINI_API_KEY or GEMINI_API_KEY == "your_real_gemini_api_key_here":
        return "Gemini API key is missing. Please add a valid GEMINI_API_KEY to your .env file.", "error", "auth"

    MAX_CHARS_PER_CHUNK = int(os.getenv("MAX_CHARS_PER_CHUNK", 1200))
    context_passages = []
    for source in sources:
        text = source['text']
        if len(text) > MAX_CHARS_PER_CHUNK:
            text = text[:MAX_CHARS_PER_CHUNK]
        context_passages.append(f"Source {source['source_number']}: {text}")

    context = "\n\n".join(context_passages)

    prompt = f"""
You are Raya, an Islamic knowledge assistant for ZaryahPlus.

You must answer the user's question only using the provided source passages.
Do not use outside knowledge.
Do not guess.
If the answer is not clearly present in the source passages, say:
"I could not find relevant information about this in the uploaded text."

User question:
{question}

Source passages:
{context}

Answer:
"""
    model_name = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")

    for attempt in range(3):
        try:
            model = genai.GenerativeModel(model_name)
            response = model.generate_content(prompt)
            return response.text, "success", None
        except Exception as e:
            error_str = str(e).lower()
            if "429" in error_str or "quota" in error_str or "rate limit" in error_str or "resource_exhausted" in error_str:
                if attempt < 2:
                    time.sleep(4)
                    continue
                return "Gemini API quota exceeded. Please try again later, use a lighter model, or enable billing in Google AI Studio.", "error", "quota"
            return f"Error calling Gemini API: {str(e)}", "error", "api"
            
    return "Error: Failed to generate answer after multiple retries.", "error", "retry_failed"

@app.get("/")
def home():
    return {
        "message": "Islamic Knowledge Assistant RAG backend is running"
    }

@app.post("/upload")
async def upload_file(file: UploadFile = File(...)):
    if not file.filename.endswith(".txt"):
        raise HTTPException(status_code=400, detail="Only .txt files are allowed")

    content = await file.read()
    text = content.decode("utf-8", errors="ignore")

    if not text.strip():
        raise HTTPException(status_code=400, detail="Uploaded file is empty")
        
    words = text.split()
    total_word_count = len(words)
    
    # Chunking
    chunks = chunk_text(text)
    
    # Generating embeddings
    embeddings = generate_embeddings(chunks)
    
    # Database logic
    clear_collection()
    store_chunks(chunks, embeddings, file.filename)
    
    # Verify count in DB
    stored_count = collection.count()

    return {
        "message": "File uploaded, chunked, embedded, and stored successfully",
        "filename": file.filename,
        "total_word_count": total_word_count,
        "total_chunks": len(chunks),
        "embedding_model": embedding_model_name,
        "embedding_dimension": len(embeddings[0]) if embeddings else 0,
        "total_embeddings_created": len(embeddings),
        "total_chunks_stored": stored_count,
        "collection_name": collection_name
    }

@app.post("/query")
def query_text(request: QueryRequest):
    if not request.question.strip():
        raise HTTPException(status_code=400, detail="Question cannot be empty")
        
    if collection.count() == 0:
        raise HTTPException(status_code=400, detail="No document has been uploaded or indexed yet.")

    sources = retrieve_relevant_chunks(request.question)
    
    RELEVANCE_DISTANCE_THRESHOLD = 1.6

    # Relevance threshold check
    if not sources:
        return {
            "answer": "I could not find relevant information about this in the uploaded text.",
            "status": "success",
            "sources": []
        }
        
    best_distance = sources[0].get("distance")
    if best_distance is not None and best_distance > RELEVANCE_DISTANCE_THRESHOLD:
        return {
            "answer": "I could not find relevant information about this in the uploaded text.",
            "status": "success",
            "sources": sources
        }

    answer, status, error_type = generate_llm_answer(request.question, sources)

    return {
        "question": request.question,
        "answer": answer,
        "sources": sources,
        "status": status,
        "error_type": error_type
    }
