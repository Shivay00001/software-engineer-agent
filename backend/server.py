import os
import uuid
import json
import asyncio
import re
from contextlib import asynccontextmanager
from fastapi import FastAPI, Depends, Request, BackgroundTasks, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from dotenv import load_dotenv
import litellm
from typing import List

from database import engine, Base, SessionLocal, get_db
from models import Setting, ExecutionLog

load_dotenv()

@asynccontextmanager
async def lifespan(app: FastAPI):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    
    # Initialize workspace dir
    os.makedirs("workspace", exist_ok=True)
    yield

app = FastAPI(lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/workspace", StaticFiles(directory="workspace"), name="workspace")

async def get_api_key(db: AsyncSession, key_name: str, env_fallback: str) -> str:
    result = await db.execute(select(Setting).where(Setting.key == key_name))
    setting = result.scalar_one_or_none()
    if setting and setting.value:
        return setting.value
    return os.getenv(env_fallback)

def get_api_key(model_id: str, api_keys: dict):
    if model_id.startswith("gpt"):
        return api_keys.get("openai") or os.getenv("OPENAI_API_KEY")
    elif model_id.startswith("claude"):
        return api_keys.get("anthropic") or os.getenv("ANTHROPIC_API_KEY")
    elif model_id.startswith("gemini"):
        return api_keys.get("gemini") or os.getenv("GEMINI_API_KEY")
    elif model_id.startswith("zhipu"):
        return api_keys.get("glm") or os.getenv("ZHIPUAI_API_KEY")
    return None
def parse_and_write_files(task_id: str, llm_output: str) -> List[str]:
    """
    Parses LLM output for custom file blocks and writes them to the workspace.
    Expected format:
    ### FILENAME: path/to/file.ext
    ```language
    content
    ```
    """
    workspace_dir = os.path.join("workspace", task_id)
    os.makedirs(workspace_dir, exist_ok=True)
    
    generated_files = []
    
    # Split by the FILENAME marker
    parts = re.split(r'### FILENAME:\s*(.+)', llm_output)
    
    if len(parts) > 1:
        # parts[0] is everything before the first marker
        for i in range(1, len(parts), 2):
            filepath = parts[i].strip()
            content = parts[i+1].strip()
            
            # Remove markdown code blocks if present
            content = re.sub(r'^```[a-zA-Z]*\n', '', content)
            content = re.sub(r'\n```$', '', content)
            
            # Ensure path safety (no escaping workspace)
            safe_path = os.path.normpath(filepath)
            if safe_path.startswith("..") or os.path.isabs(safe_path):
                continue
                
            full_path = os.path.join(workspace_dir, safe_path)
            os.makedirs(os.path.dirname(full_path), exist_ok=True)
            
            with open(full_path, "w", encoding="utf-8") as f:
                f.write(content)
                
            generated_files.append(safe_path)
            
    return generated_files

async def process_swe_job(task_id: str, prompt: str, tech_stack: str, provider: str, api_keys: dict):
    async with SessionLocal() as db:
        try:
            result = await db.execute(select(ExecutionLog).where(ExecutionLog.task_id == task_id))
            log = result.scalar_one()
            log.status = "running"
            await db.commit()
            
            api_key = get_api_key(provider, api_keys)
            api_base = "http://localhost:11434" if provider.startswith("ollama") else None
            
            system_prompt = (
                "You are an expert Software Engineer AI. "
                "Your objective is to generate the complete codebase for the user's request. "
                "CRITICAL INSTRUCTIONS:\n"
                "1. You MUST output each file using exactly this format:\n"
                "### FILENAME: relative/path/to/file.ext\n"
                "```\n"
                "file content here\n"
                "```\n"
                "2. Do not use absolute paths. Ensure all paths are relative to the project root.\n"
                "3. Provide complete code, do not use placeholders like '// implement here'.\n"
                "4. Architect the software adhering to best practices for the chosen tech stack."
            )
            
            user_prompt = f"Tech Stack: {tech_stack}\nTask: {prompt}\n\nPlease generate the full project files."
            
            # Use a longer timeout for huge codebase generation
            response = await litellm.acompletion(
                model=provider,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt}
                ],
                api_key=api_key,
                api_base=api_base,
                max_tokens=4000,
                timeout=120.0
            )
            
            llm_output = response.choices[0].message.content
            
            written_files = parse_and_write_files(task_id, llm_output)
            
            log.generated_files = json.dumps(written_files)
            log.status = "success"
            await db.commit()
            
        except Exception as e:
            print(f"Error processing SWE job: {e}")
            result = await db.execute(select(ExecutionLog).where(ExecutionLog.task_id == task_id))
            log = result.scalar_one_or_none()
            if log:
                log.status = "error"
                log.generated_files = json.dumps([str(e)])
                await db.commit()

class ExecuteRequest(BaseModel):
    prompt: str
    tech_stack: str
    provider: str

@app.post("/api/execute")
async def enqueue_swe_task(req: ExecuteRequest, background_tasks: BackgroundTasks, request: Request, db: AsyncSession = Depends(get_db)):
    task_id = str(uuid.uuid4())
    
    log = ExecutionLog(
        task_id=task_id,
        prompt=req.prompt,
        tech_stack=req.tech_stack,
        model_provider=req.provider,
        status="pending"
    )
    db.add(log)
    await db.commit()
    
    api_keys = {
        "openai": request.headers.get("X-OpenAI-Key"),
        "anthropic": request.headers.get("X-Anthropic-Key"),
        "gemini": request.headers.get("X-Gemini-Key"),
        "glm": request.headers.get("X-GLM-Key")
    }
    
    background_tasks.add_task(process_swe_job, task_id, req.prompt, req.tech_stack, req.provider, api_keys)
    
    return {"status": "success", "task_id": task_id}

@app.get("/api/tasks/{task_id}")
async def get_task_status(task_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(ExecutionLog).where(ExecutionLog.task_id == task_id))
    log = result.scalar_one_or_none()
    
    if not log:
        raise HTTPException(status_code=404, detail="Task not found")
        
    files = []
    if log.generated_files:
        try:
            files = json.loads(log.generated_files)
        except:
            pass
            
    return {
        "status": log.status,
        "files": files
    }

class ApiKeysUpdate(BaseModel):
    openai_api_key: str

@app.post("/api/settings/keys")
async def update_keys(req: ApiKeysUpdate, db: AsyncSession = Depends(get_db)):
    if req.openai_api_key:
        res = await db.execute(select(Setting).where(Setting.key == "openai_api_key"))
        setting = res.scalar_one_or_none()
        if setting:
            setting.value = req.openai_api_key
        else:
            db.add(Setting(key="openai_api_key", value=req.openai_api_key))
        await db.commit()
    return {"status": "success"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("server:app", host="0.0.0.0", port=8003, reload=True)
