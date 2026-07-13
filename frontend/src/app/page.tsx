'use client';

import { useState, useEffect } from 'react';

export default function Home() {
  const [provider, setProvider] = useState('gpt-4o');
  const [keys, setKeys] = useState({ openai: '', anthropic: '', gemini: '', glm: '' });
  const [techStack, setTechStack] = useState('React, Next.js, TailwindCSS');
  const [prompt, setPrompt] = useState('Build a calculator app with history functionality.');
  
  const [status, setStatus] = useState<'idle' | 'pending' | 'running' | 'success' | 'error'>('idle');
  const [taskId, setTaskId] = useState('');
  const [generatedFiles, setGeneratedFiles] = useState<string[]>([]);
  const [message, setMessage] = useState('');

  useEffect(() => {
    setKeys({
      openai: localStorage.getItem('swe_openai_key') || '',
      anthropic: localStorage.getItem('swe_anthropic_key') || '',
      gemini: localStorage.getItem('swe_gemini_key') || '',
      glm: localStorage.getItem('swe_glm_key') || ''
    });

    let interval: NodeJS.Timeout;
    if (taskId && (status === 'pending' || status === 'running')) {
      interval = setInterval(async () => {
        try {
          const res = await fetch(`http://localhost:8003/api/tasks/${taskId}`);
          if (res.ok) {
            const data = await res.json();
            setStatus(data.status);
            if (data.status === 'success') {
              setGeneratedFiles(data.files || []);
              setMessage('Codebase generation complete!');
            } else if (data.status === 'error') {
              setMessage('Error generating codebase.');
            }
          }
        } catch (e) {
          console.error("Polling error", e);
        }
      }, 3000);
    }
    return () => clearInterval(interval);
  }, [taskId, status]);

  const handleKeyChange = (p: string, val: string) => {
    setKeys(prev => ({...prev, [p]: val}));
  };

  const handleExecute = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt) return;

    setStatus('pending');
    setMessage('Initializing software architecture pipeline...');
    setGeneratedFiles([]);
    
    try {
      localStorage.setItem('swe_openai_key', keys.openai);
      localStorage.setItem('swe_anthropic_key', keys.anthropic);
      localStorage.setItem('swe_gemini_key', keys.gemini);
      localStorage.setItem('swe_glm_key', keys.glm);

      const res = await fetch('http://localhost:8003/api/execute', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'X-OpenAI-Key': keys.openai,
          'X-Anthropic-Key': keys.anthropic,
          'X-Gemini-Key': keys.gemini,
          'X-GLM-Key': keys.glm
        },
        body: JSON.stringify({
          prompt,
          tech_stack: techStack,
          provider
        }),
      });
      
      const data = await res.json();
      if (res.ok) {
        setTaskId(data.task_id);
        setMessage('Task queued. Writing code... This may take a few minutes.');
      } else {
        setStatus('error');
        setMessage(data.detail || 'Failed to start task.');
      }
    } catch (e) {
      console.error(e);
      setStatus('error');
      setMessage('Network error. Ensure backend is running.');
    }
  };

  return (
    <main className="dashboard-container">
      <div className="dashboard-header">
        <h1>[SWE-Agent]</h1>
        <p>Autonomous Software Engineering & Architecture Pipeline</p>
      </div>

      <div style={{display: 'flex', gap: '30px'}}>
        <div style={{flex: 1}}>
          <div className="panel">
            <h2 className="panel-title">System Configuration</h2>
            <div className="form-group">
              <label>OpenAI (GPT-4o)</label>
              <input type="password" value={keys.openai} onChange={(e) => handleKeyChange('openai', e.target.value)} disabled={status === 'pending' || status === 'running'} />
            </div>
            <div className="form-group">
              <label>Anthropic (Claude 3.5)</label>
              <input type="password" value={keys.anthropic} onChange={(e) => handleKeyChange('anthropic', e.target.value)} disabled={status === 'pending' || status === 'running'} />
            </div>
            <div className="form-group">
              <label>Google AI (Gemini 1.5)</label>
              <input type="password" value={keys.gemini} onChange={(e) => handleKeyChange('gemini', e.target.value)} disabled={status === 'pending' || status === 'running'} />
            </div>
            <div className="form-group">
              <label>ZhipuAI (GLM-4)</label>
              <input type="password" value={keys.glm} onChange={(e) => handleKeyChange('glm', e.target.value)} disabled={status === 'pending' || status === 'running'} />
            </div>

            <div className="form-group">
              <label>LLM Engine</label>
              <select value={provider} onChange={(e) => setProvider(e.target.value)} disabled={status === 'pending' || status === 'running'}>
                <option value="gpt-4o">OpenAI (gpt-4o)</option>
                <option value="claude-3-5-sonnet-20240620">Anthropic (claude-3-5-sonnet)</option>
                <option value="gemini/gemini-1.5-pro">Google AI (gemini-1.5-pro)</option>
                <option value="zhipu/glm-4">ZhipuAI (glm-4)</option>
                <option value="ollama/llama3">Local Ollama (Llama 3)</option>
              </select>
            </div>
          </div>

          <div className="panel">
            <h2 className="panel-title">Project Definition</h2>
            <form onSubmit={handleExecute}>
              <div className="form-group">
                <label>Tech Stack</label>
                <input 
                  type="text" 
                  value={techStack} 
                  onChange={(e) => setTechStack(e.target.value)} 
                  placeholder="e.g. React, Node.js, Express"
                  required
                  disabled={status === 'pending' || status === 'running'}
                />
              </div>
              <div className="form-group">
                <label>Feature Requirements</label>
                <textarea 
                  value={prompt} 
                  onChange={(e) => setPrompt(e.target.value)} 
                  placeholder="Describe the application you want to build..." 
                  rows={6}
                  required
                  disabled={status === 'pending' || status === 'running'}
                />
              </div>
              <button 
                type="submit" 
                className="btn" 
                style={{width: '100%'}}
                disabled={status === 'pending' || status === 'running'}
              >
                {status === 'pending' || status === 'running' ? 'Compiling AI Logic...' : 'Generate Codebase'}
              </button>
            </form>
          </div>

          {status !== 'idle' && (
            <div className={`status-message ${status}`}>
              {status === 'running' && <span className="animate-pulse">Building... </span>}
              {message}
            </div>
          )}
        </div>

        <div style={{flex: 1}}>
          <div className="panel" style={{height: '100%'}}>
            <h2 className="panel-title">Code Explorer (workspace/{taskId || '...'})</h2>
            {status === 'idle' ? (
              <p style={{color: '#8b949e', textAlign: 'center', marginTop: '50px'}}>No project generated yet.</p>
            ) : status === 'running' || status === 'pending' ? (
              <div style={{textAlign: 'center', marginTop: '50px', color: 'var(--accent)'}}>
                <p>Generative AI is architecting your solution...</p>
                <p style={{fontSize: '0.8rem', marginTop: '10px'}}>This process involves multi-file reasoning and may take 1-3 minutes.</p>
              </div>
            ) : (
              <ul className="file-list">
                {generatedFiles.length === 0 ? (
                  <li>No files generated.</li>
                ) : (
                  generatedFiles.map((file, i) => (
                    <li key={i} className="file-item">{file}</li>
                  ))
                )}
              </ul>
            )}
            {status === 'success' && generatedFiles.length > 0 && (
              <div style={{marginTop: '20px', padding: '15px', background: 'rgba(46, 160, 67, 0.1)', border: '1px solid var(--success)', borderRadius: '6px'}}>
                ✅ Codebase written to disk! Open the <code>workspace/{taskId}</code> folder in VS Code to run your app.
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
