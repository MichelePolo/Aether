import React, { useState, useEffect, useRef } from "react";
import { 
  Terminal, 
  Settings, 
  Cpu, 
  Shield, 
  Wrench, 
  History, 
  Send, 
  Command, 
  ChevronRight,
  Database,
  Info,
  Maximize2,
  Trash2,
  Pencil,
  RefreshCw,
  Braces,
  MoreVertical,
  Layers,
  Save,
  Download,
  Upload,
  FolderOpen,
  Sliders
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import ReactMarkdown from "react-markdown";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface ReasoningStep {
  id: string;
  type: "logic" | "dispatch" | "validation" | "context_fetch" | "mcp_query";
  title: string;
  content: string;
  confidence?: number;
  tokens?: number;
  subAgent?: string;
}

interface Message {
  id: string;
  role: "user" | "model" | "system";
  text: string;
  reasoning?: string;
  reasoningSteps?: ReasoningStep[];
  timestamp: number;
  model?: string;
}

interface AIContext {
  systemInstruction: string;
  skills: string[];
  tools: any[];
  mcpServers: any[];
  history: any[];
}

interface Profile {
  id: string;
  name: string;
  context: Partial<AIContext>;
}

export default function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [selectedModel, setSelectedModel] = useState("gemini-3-flash-preview");
  const [isLoading, setIsLoading] = useState(false);
  const [context, setContext] = useState<AIContext | null>(null);
  const [activeTab, setActiveTab] = useState<"chat" | "reasoning" | "mcp">("chat");
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [modelConfig, setModelConfig] = useState({ temperature: 1, maxOutputTokens: 8192 });
  const [showModelConfig, setShowModelConfig] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchContext();
    loadProfiles();
  }, []);

  const loadProfiles = () => {
    const saved = localStorage.getItem("aether_profiles");
    if (saved) setProfiles(JSON.parse(saved));
  };

  const saveProfile = (name: string) => {
    if (!context) return;
    const newProfile: Profile = {
      id: Date.now().toString(),
      name,
      context: {
        systemInstruction: context.systemInstruction,
        skills: context.skills,
        tools: context.tools,
        mcpServers: context.mcpServers
      }
    };
    const updated = [...profiles, newProfile];
    setProfiles(updated);
    localStorage.setItem("aether_profiles", JSON.stringify(updated));
  };

  const loadProfile = async (profile: Profile) => {
    try {
      const res = await fetch("/api/context/bulk-overwrite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ context: profile.context }),
      });
      const data = await res.json();
      setContext(data.context);
    } catch (err) {
      console.error("Failed to load profile", err);
    }
  };

  const exportContext = () => {
    if (!context) return;
    const blob = new Blob([JSON.stringify(context, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `aether_context_${Date.now()}.json`;
    a.click();
  };

  const importContext = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const imported = JSON.parse(event.target?.result as string);
        const res = await fetch("/api/context/bulk-overwrite", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ context: imported }),
        });
        const data = await res.json();
        setContext(data.context);
      } catch (err) {
        alert("Invalid context file");
      }
    };
    reader.readAsText(file);
  };

  const fetchContext = async () => {
    try {
      const res = await fetch("/api/context");
      const data = await res.json();
      setContext(data);
    } catch (error) {
      console.error("Failed to fetch context", error);
    }
  };

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const updateContext = async (updates: Partial<AIContext>) => {
    try {
      const res = await fetch("/api/context/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      const data = await res.json();
      setContext(data.context);
    } catch (error) {
      console.error("Failed to update context", error);
    }
  };

  const handleAddSkill = () => {
    const name = prompt("Enter new skill name:");
    if (name && name.trim()) {
      if (context) {
        updateContext({ skills: [...context.skills, name.trim()] });
      }
    }
  };

  const handleEditSkill = (index: number) => {
    if (!context) return;
    const oldName = context.skills[index];
    const newName = prompt("Edit skill name:", oldName);
    if (newName && newName.trim() && newName.trim() !== oldName) {
      const updatedSkills = [...context.skills];
      updatedSkills[index] = newName.trim();
      updateContext({ skills: updatedSkills });
    }
  };

  const handleRemoveSkill = (index: number) => {
    if (!context) return;
    if (confirm(`Remove skill "${context.skills[index]}"?`)) {
      const updatedSkills = context.skills.filter((_, i) => i !== index);
      updateContext({ skills: updatedSkills });
    }
  };

  const handleAddTool = () => {
    const name = prompt("Enter new tool name:");
    if (!name || !name.trim()) return;
    const version = prompt("Enter version (e.g., 1.0.0):", "1.0.0");
    if (!version) return;
    const statusStr = prompt("Enter status (online/offline):", "online");
    const status = statusStr?.toLowerCase() === "online" ? "online" : "offline";
    
    if (context) {
      updateContext({ tools: [...context.tools, { name: name.trim(), version: version.trim(), status }] });
    }
  };

  const handleEditTool = (index: number) => {
    if (!context) return;
    const tool = context.tools[index];
    const newName = prompt("Edit tool name:", tool.name);
    if (!newName || !newName.trim()) return;
    const newVersion = prompt("Edit version:", tool.version);
    if (!newVersion) return;
    const newStatusStr = prompt("Edit status (online/offline):", tool.status);
    const newStatus = newStatusStr?.toLowerCase() === "online" ? "online" : "offline";

    const updatedTools = [...context.tools];
    updatedTools[index] = { name: newName.trim(), version: newVersion.trim(), status: newStatus };
    updateContext({ tools: updatedTools });
  };

  const handleRemoveTool = (index: number) => {
    if (!context) return;
    if (confirm(`Remove tool "${context.tools[index].name}"?`)) {
      const updatedTools = context.tools.filter((_, i) => i !== index);
      updateContext({ tools: updatedTools });
    }
  };

  const handleAddMcpServer = () => {
    const name = prompt("Enter MCP server name:");
    if (!name || !name.trim()) return;
    const url = prompt("Enter Server URL:", "http://localhost:8080/mcp");
    if (!url) return;
    const statusStr = prompt("Enter status (online/offline/connecting):", "connecting");
    const status = ["online", "offline"].includes(statusStr?.toLowerCase() || "") ? statusStr?.toLowerCase() : "connecting";
    
    if (context) {
      updateContext({ mcpServers: [...(context.mcpServers || []), { name: name.trim(), url: url.trim(), status }] });
    }
  };

  const handleEditMcpServer = (index: number) => {
    if (!context) return;
    const server = (context.mcpServers || [])[index];
    if (!server) return;
    
    const newName = prompt("Edit MCP server name:", server.name);
    if (!newName || !newName.trim()) return;
    const newUrl = prompt("Edit Server URL:", server.url);
    if (!newUrl) return;
    const newStatusStr = prompt("Edit status (online/offline/connecting):", server.status);
    const newStatus = ["online", "offline"].includes(newStatusStr?.toLowerCase() || "") ? newStatusStr?.toLowerCase() : "connecting";

    const updatedServers = [...(context.mcpServers || [])];
    updatedServers[index] = { name: newName.trim(), url: newUrl.trim(), status: newStatus };
    updateContext({ mcpServers: updatedServers });
  };

  const handleRemoveMcpServer = (index: number) => {
    if (!context) return;
    const server = (context.mcpServers || [])[index];
    if (!server) return;
    if (confirm(`Remove MCP server "${server.name}"?`)) {
      const updatedServers = (context.mcpServers || []).filter((_, i) => i !== index);
      updateContext({ mcpServers: updatedServers });
    }
  };

  const handleSend = async () => {
    if (!inputValue.trim() || isLoading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      text: inputValue,
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputValue("");
    setIsLoading(true);

    const aiMessageId = Date.now().toString() + "-ai";
    const initialAiMessage: Message = {
      id: aiMessageId,
      role: "model",
      text: "",
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, initialAiMessage]);

    try {
      const res = await fetch("/api/ai/dispatch/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: inputValue,
          model: selectedModel,
          config: modelConfig
        }),
      });

      if (!res.body) throw new Error("No response body");

      const reader = res.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let done = false;
      let aiText = "";

      while (!done) {
        const { value, done: readerDone } = await reader.read();
        done = readerDone;
        if (value) {
          const chunk = decoder.decode(value, { stream: !done });
          const lines = chunk.split('\n');
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const dataStr = line.replace('data: ', '');
              if (!dataStr) continue;
              try {
                const data = JSON.parse(dataStr);
                if (data.error) throw new Error(data.error);
                if (data.text) {
                  aiText = data.done ? data.text : aiText + data.text;
                  setMessages(prev => prev.map(m => m.id === aiMessageId ? { ...m, text: aiText } : m));
                }
                if (data.done) {
                  setMessages(prev => prev.map(m => m.id === aiMessageId ? {
                    ...m,
                    text: data.text,
                    reasoning: data.reasoning,
                    reasoningSteps: data.reasoningSteps,
                    model: data.model
                  } : m));
                  fetchContext();
                }
              } catch (e) {
                // ignore json parse errors for incomplete chunks
              }
            }
          }
        }
      }
    } catch (error: any) {
      console.error("Dispatch Error:", error);
      const errorMessage: Message = {
        id: Date.now().toString(),
        role: "system",
        text: `Error: ${error.message}`,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const resetHistory = async () => {
    await fetch("/api/context/reset", { method: "POST" });
    setMessages([]);
    fetchContext();
  };

  return (
    <div className="flex h-screen w-full bg-[#0a0a0a] text-zinc-300 font-sans">
      {/* Sidebar - Context Disclosure */}
      <AnimatePresence>
        {isSidebarOpen && (
          <motion.aside
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 320, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            className="border-r border-zinc-800 bg-[#0f0f0f] flex flex-col z-20 shrink-0 overflow-hidden"
          >
            <div className="p-4 border-b border-zinc-800 flex items-center justify-between bg-[#121212]">
              <div className="flex items-center gap-2">
                <Command className="w-4 h-4 text-[var(--color-accent)]" />
                <span className="font-mono text-sm tracking-tight text-white font-bold">AETHER_CORE</span>
              </div>
              <Settings className="w-4 h-4 text-zinc-500 cursor-pointer hover:text-white transition-colors" />
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-6 scrollbar-hide">
              {/* System Instruction */}
              <section>
                <div className="flex items-center gap-2 mb-2">
                  <Shield className="w-3.5 h-3.5 text-zinc-500" />
                  <span className="mono-label">System Protocol</span>
                </div>
                <textarea
                  className="w-full bg-zinc-900/50 border border-zinc-800 rounded p-2 text-xs font-mono text-zinc-400 focus:border-[var(--color-accent)] outline-none min-h-[120px] resize-none"
                  value={context?.systemInstruction || ""}
                  onChange={(e) => updateContext({ systemInstruction: e.target.value })}
                />
              </section>

              {/* Environments - Persistence & Profiles */}
              <section>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <FolderOpen className="w-3.5 h-3.5 text-zinc-500" />
                    <span className="mono-label">Environments</span>
                  </div>
                  <div className="flex gap-1">
                    <button onClick={() => fileInputRef.current?.click()} title="Import Context JSON">
                      <Upload className="w-3 h-3 text-zinc-500 hover:text-white transition-colors" />
                    </button>
                    <button onClick={exportContext} title="Export Context JSON">
                      <Download className="w-3 h-3 text-zinc-500 hover:text-white transition-colors" />
                    </button>
                  </div>
                </div>

                <input 
                  type="file" 
                  ref={fileInputRef} 
                  className="hidden" 
                  accept=".json" 
                  onChange={importContext} 
                />

                <div className="space-y-2">
                  {profiles.map((p) => (
                    <div key={p.id} className="flex items-center justify-between p-2 rounded bg-zinc-900 border border-zinc-800">
                      <span className="text-[10px] font-mono text-zinc-400 truncate max-w-[120px]">{p.name}</span>
                      <button 
                        onClick={() => loadProfile(p)}
                        className="text-[9px] px-2 py-0.5 bg-zinc-800 hover:bg-zinc-700 rounded text-zinc-300"
                      >
                        LOAD
                      </button>
                    </div>
                  ))}
                  
                  <div className="flex gap-1 mt-2">
                    <button 
                      onClick={() => {
                        const name = prompt("Enter environment name:");
                        if (name) saveProfile(name);
                      }}
                      className="flex-1 flex items-center justify-center gap-2 p-1.5 border border-dashed border-zinc-800 rounded text-[10px] text-zinc-500 hover:text-white hover:border-zinc-600 transition-colors"
                    >
                      <Save className="w-3 h-3" />
                      Save Static Snapshot
                    </button>
                  </div>
                </div>
              </section>

              {/* Skills */}
              <section>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Cpu className="w-3.5 h-3.5 text-zinc-500" />
                    <span className="mono-label">Active Skills</span>
                  </div>
                  <span className="text-[10px] text-zinc-600">[{context?.skills?.length || 0}]</span>
                </div>
                <div className="space-y-1">
                  {context?.skills?.map((skill, i) => (
                    <div key={i} className="group flex items-center justify-between p-1.5 rounded bg-zinc-900 border border-zinc-800 text-[10px] font-mono text-zinc-400">
                      <div className="flex items-center gap-2">
                        <ChevronRight className="w-2 h-2 text-[var(--color-accent)]" />
                        <span className="truncate max-w-[150px]">{skill}</span>
                      </div>
                      <div className="hidden group-hover:flex items-center gap-1 opacity-70">
                        <button onClick={() => handleEditSkill(i)} className="hover:text-white transition-colors" title="Edit Skill">
                          <Pencil className="w-3 h-3" />
                        </button>
                        <button onClick={() => handleRemoveSkill(i)} className="hover:text-red-400 transition-colors" title="Remove Skill">
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  ))}
                  <button 
                    onClick={handleAddSkill}
                    className="w-full p-1 border border-dashed border-zinc-800 rounded text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors mt-2"
                  >
                    + Deploy New Skill
                  </button>
                </div>
              </section>

              {/* Tools */}
              <section>
                <div className="flex items-center gap-2 mb-2">
                  <Wrench className="w-3.5 h-3.5 text-zinc-500" />
                  <span className="mono-label">Tool Registry</span>
                </div>
                <div className="space-y-2">
                   {context?.tools?.map((tool: any, i: number) => (
                     <div key={i} className="group p-2 rounded bg-zinc-900/30 border border-zinc-800/50 flex flex-col gap-1">
                       <div className="flex items-center justify-between">
                         <span className="text-[10px] font-mono text-zinc-500">{tool.name} <span className="opacity-50 mx-1">v{tool.version}</span></span>
                         <div className="flex items-center gap-2">
                           <div className="hidden group-hover:flex items-center gap-1 opacity-70">
                             <button onClick={() => handleEditTool(i)} className="hover:text-white transition-colors" title="Edit Tool">
                               <Pencil className="w-3 h-3" />
                             </button>
                             <button onClick={() => handleRemoveTool(i)} className="hover:text-red-400 transition-colors" title="Remove Tool">
                               <Trash2 className="w-3 h-3" />
                             </button>
                           </div>
                           <div className={cn(
                             "w-1.5 h-1.5 rounded-full",
                             tool.status === "online" ? "bg-green-500 shadow-[0_0_8px_#22c55e]" : "bg-zinc-700"
                           )} title={tool.status} />
                         </div>
                       </div>
                     </div>
                   ))}
                   <button 
                     onClick={handleAddTool}
                     className="w-full p-1 border border-dashed border-zinc-800 rounded text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors mt-2"
                   >
                     + Register Tool
                   </button>
                </div>
              </section>

              {/* MCP Servers */}
              <section>
                <div className="flex items-center gap-2 mb-2">
                  <Layers className="w-3.5 h-3.5 text-zinc-500" />
                  <span className="mono-label">MCP Network</span>
                </div>
                <div className="space-y-2">
                  {(!context?.mcpServers || context.mcpServers.length === 0) ? (
                    <div className="text-[10px] text-zinc-600 font-mono italic">
                      No active MCP nodes connected.
                    </div>
                  ) : (
                    context.mcpServers.map((server: any, i: number) => (
                      <div key={i} className="group p-2 rounded bg-zinc-900/30 border border-zinc-800/50 flex flex-col gap-1">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-mono text-zinc-500">{server.name}</span>
                          <div className="flex items-center gap-2">
                            <div className="hidden group-hover:flex items-center gap-1 opacity-70">
                              <button onClick={() => handleEditMcpServer(i)} className="hover:text-white transition-colors" title="Edit Server">
                                <Pencil className="w-3 h-3" />
                              </button>
                              <button onClick={() => handleRemoveMcpServer(i)} className="hover:text-red-400 transition-colors" title="Remove Server">
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                            <div className={cn(
                              "w-1.5 h-1.5 rounded-full",
                              server.status === "online" ? "bg-green-500 shadow-[0_0_8px_#22c55e]" : 
                              server.status === "connecting" ? "bg-yellow-500 animate-pulse" : "bg-zinc-700"
                            )} title={server.status} />
                          </div>
                        </div>
                        <div className="text-[9px] font-mono text-zinc-600 truncate">{server.url}</div>
                      </div>
                    ))
                  )}
                  <button 
                    onClick={handleAddMcpServer}
                    className="w-full p-1 border border-dashed border-zinc-800 rounded text-[10px] text-zinc-600 hover:text-zinc-400 transition-colors mt-2"
                  >
                    + Add Connection
                  </button>
                </div>
              </section>
            </div>

            <div className="p-4 border-t border-zinc-800 flex items-center justify-between text-[10px] font-mono text-zinc-600">
              <span>LATENCY: 42ms</span>
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                <span>ONLINE</span>
              </div>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 bg-[#0a0a0a]">
        {/* Header Tabs */}
        <header className="h-12 border-b border-zinc-800 flex items-center justify-between px-4 bg-[#0f0f0f]/80 backdrop-blur-sm sticky top-0 z-10">
          <div className="flex items-center gap-1">
            <button
               onClick={() => setIsSidebarOpen(!isSidebarOpen)}
               className={cn("p-1.5 rounded hover:bg-zinc-800 transition-colors", !isSidebarOpen && "bg-zinc-800 text-white")}
            >
              <Terminal className="w-4 h-4" />
            </button>
            <div className="h-4 w-[1px] bg-zinc-800 mx-2" />
            
            {["chat", "reasoning", "mcp"].map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab as any)}
                className={cn(
                  "px-3 py-1 text-xs font-mono rounded-md transition-all capitalize",
                  activeTab === tab 
                    ? "text-[var(--color-accent)] bg-[var(--color-accent)]/5"
                    : "text-zinc-500 hover:text-zinc-300"
                )}
              >
                {tab}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
             <div className="flex items-center gap-2 bg-black border border-zinc-800 rounded px-2 py-1 mr-1">
               <Database className="w-3 h-3 text-blue-500" />
               <select 
                 className="bg-transparent border-none text-[10px] font-mono outline-none cursor-pointer"
                 value={selectedModel}
                 onChange={(e) => setSelectedModel(e.target.value)}
                >
                 <option value="gemini-3-flash-preview">Gemini 3 Flash</option>
                 <option value="gemini-3.1-pro-preview">Gemini 3.1 Pro</option>
                 <option value="local-ollama">Local: Ollama (Proxy)</option>
               </select>
             </div>
             <div className="relative">
               <button 
                 onClick={() => setShowModelConfig(!showModelConfig)} 
                 className={cn(
                   "p-1.5 rounded hover:bg-zinc-800 transition-colors",
                   showModelConfig ? "bg-zinc-800 text-white" : "text-zinc-500"
                 )}
                 title="Model Configuration"
               >
                 <Sliders className="w-4 h-4" />
               </button>
               {showModelConfig && (
                 <motion.div 
                   initial={{ opacity: 0, y: -5 }}
                   animate={{ opacity: 1, y: 0 }}
                   className="absolute right-0 top-full mt-3 w-72 bg-[#0a0a0a] border border-zinc-800 rounded-lg shadow-2xl z-50 overflow-hidden"
                 >
                   <div className="bg-zinc-900/80 p-3 px-4 flex justify-between items-center border-b border-zinc-800">
                     <span className="text-[10px] font-mono font-semibold text-white tracking-wider flex items-center gap-2 uppercase">
                       <Sliders className="w-3.5 h-3.5 text-[var(--color-accent)]" />
                       Model Parameters
                     </span>
                   </div>
                   
                   <div className="p-4 space-y-5 flex flex-col">
                     <div className="space-y-2 group">
                       <div className="flex justify-between items-center relative">
                         <div className="flex items-center gap-1.5 cursor-help" title="Controls randomness: Lowering results in more predictable responses, while higher settings produce more creative output.">
                           <label className="text-[10px] font-mono text-zinc-500 group-hover:text-zinc-300 transition-colors">Temperature</label>
                           <Info className="w-3 h-3 text-zinc-600 group-hover:text-zinc-400 transition-colors" />
                         </div>
                         <span className="text-[10px] font-mono text-[var(--color-accent)] bg-[var(--color-accent)]/10 px-1.5 py-0.5 rounded">{modelConfig.temperature.toFixed(1)}</span>
                       </div>
                       <input 
                         type="range" 
                         min="0" max="2" step="0.1" 
                         value={modelConfig.temperature}
                         onChange={(e) => setModelConfig(s => ({...s, temperature: parseFloat(e.target.value)}))}
                         className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-[var(--color-accent)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]/50"
                       />
                     </div>

                     <div className="space-y-2 group border-t border-zinc-800/50 pt-5 mt-1">
                       <div className="flex justify-between items-center relative">
                         <div className="flex items-center gap-1.5 cursor-help" title="The maximum number of tokens to generate in the completion. Determines the length of the response.">
                           <label className="text-[10px] font-mono text-zinc-500 group-hover:text-zinc-300 transition-colors">Max Tokens</label>
                           <Info className="w-3 h-3 text-zinc-600 group-hover:text-zinc-400 transition-colors" />
                         </div>
                         <span className="text-[10px] font-mono text-[var(--color-accent)] bg-[var(--color-accent)]/10 px-1.5 py-0.5 rounded">{modelConfig.maxOutputTokens}</span>
                       </div>
                       <input 
                         type="range" 
                         min="256" max="32768" step="256" 
                         value={modelConfig.maxOutputTokens}
                         onChange={(e) => setModelConfig(s => ({...s, maxOutputTokens: parseInt(e.target.value)}))}
                         className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-[var(--color-accent)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]/50"
                       />
                     </div>
                   </div>
                 </motion.div>
               )}
             </div>
             <button onClick={resetHistory} className="p-1.5 rounded hover:bg-zinc-800 text-zinc-500 hover:text-red-400 transition-colors ml-1" title="Clear History">
               <Trash2 className="w-4 h-4" />
             </button>
          </div>
        </header>

        {/* Interaction Area */}
        <div className="flex-1 overflow-hidden flex flex-col">
          <AnimatePresence mode="wait">
            {activeTab === "chat" ? (
              <motion.div 
                key="chat"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="flex-1 overflow-y-auto p-4 space-y-4 scroll-smooth"
                ref={scrollRef}
              >
                {messages.length === 0 && (
                  <div className="h-full flex flex-col items-center justify-center opacity-20 pointer-events-none">
                    <Command className="w-16 h-16 mb-4" />
                    <p className="font-mono text-sm uppercase tracking-widest text-[var(--color-accent)]">Aether OS Initialized</p>
                    <p className="text-[10px] mt-2">Ready for cross-model dispatch</p>
                  </div>
                )}
                
                {messages.map((msg) => (
                  <div 
                    key={msg.id}
                    className={cn(
                      "flex flex-col gap-1 max-w-[90%]",
                      msg.role === "user" ? "ml-auto items-end" : "mr-auto items-start"
                    )}
                  >
                    <div className="flex items-center gap-2 mb-1 px-1">
                       <span className={cn(
                         "text-[10px] font-mono tracking-tighter uppercase",
                         msg.role === "user" ? "text-zinc-500" : "text-[var(--color-accent)]"
                       )}>
                         {msg.role === "user" ? "USER_PROMPT" : `AGENT_RESPONSE [${msg.model || "CORE"}]`}
                       </span>
                    </div>
                    
                    <div className={cn(
                      "p-3 rounded-lg text-sm leading-relaxed",
                      msg.role === "user" 
                        ? "bg-zinc-800/50 border border-zinc-700 text-white" 
                        : "bg-zinc-900/80 border border-zinc-800 text-zinc-300"
                    )}>
                      <div className="markdown-body">
                        <ReactMarkdown>
                          {msg.text}
                        </ReactMarkdown>
                      </div>
                    </div>

                    {msg.reasoning && (
                      <div className="mt-2 text-[10px] font-mono bg-zinc-900/40 p-2 rounded border border-zinc-800/50 text-zinc-500 italic max-w-full overflow-hidden truncate">
                        <span className="text-[var(--color-accent)]/50 mr-1 italic">Thinking:</span> {msg.reasoning}
                      </div>
                    )}
                  </div>
                ))}
                
                {isLoading && (
                  <div className="flex items-center gap-3 p-2">
                    <RefreshCw className="w-4 h-4 animate-spin text-[var(--color-accent)]" />
                    <span className="font-mono text-[10px] tracking-widest animate-pulse">DISPATCHING_SUBAGENT...</span>
                  </div>
                )}
              </motion.div>
            ) : activeTab === "reasoning" ? (
              <motion.div 
                key="reasoning"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex-1 p-6 font-mono text-xs overflow-y-auto bg-[#080808] scrollbar-hide"
              >
                <div className="max-w-3xl mx-auto">
                  <header className="mb-8 flex items-center justify-between border-b border-zinc-800 pb-4">
                    <div>
                      <h2 className="text-white text-lg font-bold tracking-tighter">REASONING_CASCADE_VIEW</h2>
                      <p className="text-zinc-500 text-[10px] mt-1 italic uppercase tracking-widest">Live Trace of Last Model Dispatch</p>
                    </div>
                    <div className="text-right">
                      <div className="text-[10px] text-zinc-600">PROCESSOR_LOAD: 12%</div>
                      <div className="text-[10px] text-zinc-600">THREAD_ID: {Math.random().toString(36).substring(7).toUpperCase()}</div>
                    </div>
                  </header>

                  <div className="space-y-6 relative ml-4">
                    {/* The Connection Line */}
                    <div className="absolute left-[-16px] top-4 bottom-4 w-[1px] bg-gradient-to-b from-[var(--color-accent)]/80 via-zinc-800 to-transparent" />

                    {messages.filter(m => m.role === 'model').slice(-1)[0]?.reasoningSteps?.map((step, idx) => (
                      <motion.div 
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: idx * 0.1 }}
                        key={step.id}
                        className="relative group"
                      >
                        {/* Node Dot */}
                        <div className={cn(
                          "absolute -left-[20px] top-2 w-2 h-2 rounded-full border-4 border-[#080808] z-10 transition-all group-hover:scale-150",
                          step.type === 'logic' ? "bg-blue-500" : 
                          step.type === 'dispatch' ? "bg-purple-500" :
                          step.type === 'validation' ? "bg-green-500 shadow-[0_0_8px_#22c55e]" : "bg-zinc-600"
                        )} />

                        <div className="bg-zinc-900/40 border border-zinc-800 p-4 rounded-lg hover:border-zinc-700 transition-all hover:bg-zinc-900/60">
                          <div className="flex items-center justify-between mb-2">
                             <div className="flex items-center gap-2">
                               <span className={cn(
                                 "text-[9px] px-1.5 py-0.5 rounded-sm font-bold uppercase",
                                 step.type === 'logic' ? "bg-blue-500/10 text-blue-400" : 
                                 step.type === 'dispatch' ? "bg-purple-500/10 text-purple-400" :
                                 step.type === 'validation' ? "bg-green-500/10 text-green-400" : "bg-zinc-800 text-zinc-500"
                               )}>
                                 {step.type}
                               </span>
                               <h4 className="text-white text-xs font-semibold">{step.title}</h4>
                             </div>
                             {step.confidence && (
                               <div className="flex items-center gap-2" title={`Confidence: ${(step.confidence * 100).toFixed(1)}%`}>
                                 <div className="w-20 h-1.5 bg-zinc-800 rounded-full overflow-hidden flex">
                                   <motion.div 
                                     initial={{ width: 0 }}
                                     animate={{ width: `${step.confidence * 100}%` }}
                                     transition={{ duration: 1, ease: "easeOut", delay: idx * 0.15 }}
                                     className={cn(
                                       "h-full rounded-full",
                                       step.confidence >= 0.9 ? "bg-green-500 shadow-[0_0_8px_#22c55e]" :
                                       step.confidence >= 0.7 ? "bg-yellow-500 shadow-[0_0_8px_#eab308]" :
                                       "bg-red-500 shadow-[0_0_8px_#ef4444]"
                                     )} 
                                   />
                                 </div>
                                 <span className={cn(
                                   "text-[10px] font-mono font-bold",
                                   step.confidence >= 0.9 ? "text-green-500" :
                                   step.confidence >= 0.7 ? "text-yellow-500" :
                                   "text-red-500"
                                 )}>{(step.confidence * 100).toFixed(0)}% CFID</span>
                               </div>
                             )}
                          </div>

                          <p className="text-zinc-400 text-[11px] leading-relaxed mb-3">
                            {step.content}
                          </p>

                          <div className="flex flex-wrap gap-2 pt-3 border-t border-zinc-800/50 items-center">
                            {step.tokens && (
                              <div className="text-[9px] text-zinc-500 font-mono bg-zinc-900 px-1.5 py-0.5 rounded">
                                <span className="text-zinc-600 mr-1">TOKENS:</span> {step.tokens}
                              </div>
                            )}
                            {step.subAgent && (
                              <div className="text-[9px] font-mono flex items-center gap-1 bg-purple-500/10 px-1.5 py-0.5 rounded border border-purple-500/20 text-purple-400">
                                <span className="opacity-70">↳ SUB_AGENT:</span> <strong className="text-purple-300">{step.subAgent}</strong>
                              </div>
                            )}
                            <div className="text-[9px] text-zinc-500 font-mono uppercase bg-zinc-900 px-1.5 py-0.5 rounded">
                              <span className="text-zinc-600 mr-1">TARGET_ROOT:</span> {step.id === "1" ? "CONTEXT" : "LOGIC"}
                            </div>
                          </div>
                        </div>

                        {/* Visual Branch Decoration */}
                        {step.type === 'dispatch' && (
                           <div className="mt-3 ml-4 border-l-2 border-purple-500/30 pl-4 py-2 space-y-2 opacity-90 relative">
                             <div className="absolute -left-[5px] top-5 w-2 h-2 rounded-full bg-purple-500 animate-ping opacity-75" />
                             <div className="absolute -left-[4px] top-5 w-1.5 h-1.5 rounded-full bg-purple-400" />
                             <motion.div 
                               initial={{ opacity: 0, x: -5 }}
                               animate={{ opacity: 1, x: 0 }}
                               transition={{ delay: 0.3 + (idx * 0.1) }}
                               className="p-2.5 bg-gradient-to-r from-purple-900/20 to-transparent border border-purple-500/20 rounded shadow-lg flex items-center gap-3 text-[10px] text-zinc-300"
                             >
                               <RefreshCw className="w-3.5 h-3.5 text-purple-400 animate-spin" />
                               <span className="italic">Executing cross-model validation logic on <strong className="font-semibold text-purple-300 tracking-wide">{selectedModel}</strong>...</span>
                             </motion.div>
                           </div>
                        )}
                      </motion.div>
                    ))}
                    
                    {!messages.some(m => m.role === 'model') && (
                      <div className="text-center py-20 opacity-30">
                        <Braces className="w-12 h-12 mx-auto mb-4" />
                        <p className="uppercase tracking-[0.2em]">No trace available</p>
                        <p className="text-[9px] mt-2">Reasoning logs populate after first successful model interaction.</p>
                      </div>
                    )}
                  </div>
                </div>
              </motion.div>
            ) : (
               <motion.div 
               key="mcp"
               initial={{ opacity: 0 }}
               animate={{ opacity: 1 }}
               className="flex-1 flex items-center justify-center flex-col gap-4 text-zinc-600"
             >
               <Layers className="w-12 h-12 opacity-10" />
               <p className="font-mono text-[10px] tracking-widest">MCP_ORCHESTRATOR_IDLE</p>
             </motion.div>
            )}
          </AnimatePresence>

          {/* Input Area */}
          <footer className="p-4 bg-[#0d0d0d] border-t border-zinc-800">
            <div className="max-w-4xl mx-auto flex items-center gap-3 bg-zinc-950 border border-zinc-800 rounded-lg pr-2 py-1.5 pl-4 focus-within:border-[var(--color-accent)] transition-all shadow-2xl">
              <span className="text-[var(--color-accent)] font-mono text-sm select-none">$</span>
              <input
                ref={inputRef}
                className="cli-input text-sm py-1 placeholder:text-zinc-700"
                placeholder="Enter prompt or command... (e.g. /dispatch 'analyze code')"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSend()}
              />
              <button 
                onClick={handleSend}
                disabled={isLoading || !inputValue.trim()}
                className="p-1.5 rounded-md bg-[var(--color-accent)]/10 text-[var(--color-accent)] hover:bg-[var(--color-accent)] hover:text-black transition-all disabled:opacity-30 disabled:pointer-events-none"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
            <div className="mt-2 flex items-center justify-center gap-4 text-[9px] font-mono text-zinc-600 uppercase tracking-widest">
              <span>Mod+Enter to Submit</span>
              <div className="w-1 h-1 rounded-full bg-zinc-800" />
              <span>/help for commands</span>
              <div className="w-1 h-1 rounded-full bg-zinc-800" />
              <span>GPU Cluster: ACTIVE</span>
            </div>
          </footer>
        </div>
      </main>
    </div>
  );
}
