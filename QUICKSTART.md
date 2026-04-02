# Quick Start: Making Your Agent Powerful

## The agent is ALREADY powerful — it just needs the right model

Your agent has **all the tools** it needs to autonomously:
- ✅ Read files (`FileReadTool`)
- ✅ Edit files (`FileEditTool`, `FileWriteTool`)  
- ✅ Run terminal commands (`TerminalTool`)
- ✅ Search code (`GrepTool`)
- ✅ Execute bash scripts (`BashTool`)

**The problem**: Small models like `phi3:mini` can't follow the JSON schema required to use these tools.

## How to Get Autonomous Agent Behavior

### Step 1: Install a Capable Model

```bash
# Best for agent tasks (7B-8B parameter models)
ollama pull qwen2.5:7b          # Recommended: fast + reliable
ollama pull deepseek-coder:6.7b # Best for code editing
ollama pull llama3.1:8b         # Strong reasoning + tool use

# Check what you have installed
ollama list
```

### Step 2: Select the Model in the UI

1. Start the dev server: `npm run dev:web`
2. Open `http://localhost:3000`
3. In the Agent panel (right side), click the **Model** dropdown
4. Select `qwen2.5:7b` or `deepseek-coder:6.7b`

**OR** set environment variable (permanent):

```bash
# In apps/web/.env.local
OLLAMA_MODEL=qwen2.5:7b
```

### Step 3: Test Autonomous Behavior

Try these prompts to see the agent working autonomously:

```
"Read package.json and run npm install in the terminal"
"Create a new file hello.ts with a hello world function"
"Find all TODO comments in the codebase using grep"
"Change the port in server.mjs from 3000 to 8080"
"Run npm run dev in the terminal"
```

With a capable model, the agent will:
1. Parse your request
2. Call the right tools (FileReadTool, FileEditTool, TerminalTool, etc.)
3. Chain multiple actions (read → edit → run)
4. Return a summary when done

## Why Small Models Don't Work

Small models (< 7B parameters) like `phi3:mini`, `phi4:mini`, `gemma3:4b`:
- Cannot reliably produce structured JSON with specific field names
- Ignore the `action` field requirement
- Return prose instead of tool calls
- Hallucinate random JSON keys

The agent has **automatic format repair** (up to 3 retries) and can **extract text from malformed JSON**, but these are fallbacks — not a replacement for a capable model.

## Performance Comparison

| Model | Size | Tool Use | Speed | Best For |
|-------|------|----------|-------|----------|
| `qwen2.5:7b` | 7B | ✅ Excellent | Fast | General agent tasks |
| `deepseek-coder:6.7b` | 6.7B | ✅ Excellent | Fast | Code editing |
| `llama3.1:8b` | 8B | ✅ Excellent | Medium | Complex reasoning |
| `qwen3:4b` | 4B | ⚠️ Basic | Very fast | Simple Q&A only |
| `phi3:mini` | 3.8B | ❌ Poor | Very fast | Not suitable |
| `phi4:mini` | 3.8B | ⚠️ Limited | Very fast | Simple tasks only |

## Advanced: Increase Step Limit

For very complex tasks (large refactors, multiple file operations):

```bash
# In apps/web/.env.local
AGENT_MAX_STEPS=100  # Default is 64, max is 100
```

Or send `maxSteps` in the API request body:

```typescript
fetch("/agent/run", {
  method: "POST",
  body: JSON.stringify({
    prompt: "...",
    model: "qwen2.5:7b",
    maxSteps: 80  // Override default
  })
})
```

## Summary

**The agent is already powerful.** It has all the tools for autonomous file editing and terminal execution. You just need to:

1. **Use a 7B+ model** (`qwen2.5:7b`, `deepseek-coder:6.7b`, or `llama3.1:8b`)
2. **Avoid small models** like `phi3:mini` for agent tasks
3. **Increase step limit** if needed for complex workflows

After switching to a capable model, prompts like "use npm run dev to run the project" will automatically invoke `TerminalTool` and execute in your integrated terminal.
