import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Check, Copy, Edit3, Share2, Volume2 } from 'lucide-react';
import ToolExecutionSummary from './ToolExecutionSummary';

async function copyText(text) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  const input = document.createElement('textarea'); input.value = text; input.style.position = 'fixed'; input.style.opacity = '0'; document.body.appendChild(input); input.select(); document.execCommand('copy'); input.remove();
}

export default function ProjectMessage({ message, toolCalls, modelLabel, onEdit }) {
  const isUser = message.role === 'user'; const [copied, setCopied] = useState(false); const text = message.text || '';
  const handleCopy = async () => { try { await copyText(text); setCopied(true); window.setTimeout(() => setCopied(false), 1500); } catch { /* clipboard unavailable */ } };
  const handleRead = () => { if (!window.speechSynthesis || !text) return; window.speechSynthesis.cancel(); window.speechSynthesis.speak(new SpeechSynthesisUtterance(text)); };
  const handleShare = async () => { try { if (navigator.share) await navigator.share({ text }); else await copyText(text); } catch { /* sharing cancelled */ } };
  return <article className={`project-message ${isUser ? 'user' : 'assistant'}`}><div className="project-message-body">
    {!isUser && <div className="message-meta"><strong>{modelLabel || 'Gemini'}</strong></div>}
    {isUser ? <><div className="user-bubble"><ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown></div><div className="message-actions">
      <button type="button" onClick={handleRead} aria-label="Đọc tin nhắn" title="Đọc tin nhắn"><Volume2 size={14} /></button>
      <button type="button" onClick={handleCopy} aria-label="Sao chép" title={copied ? 'Đã sao chép' : 'Sao chép'}>{copied ? <Check size={14} /> : <Copy size={14} />}</button>
      <button type="button" onClick={() => onEdit?.(message)} aria-label="Chỉnh sửa" title="Chỉnh sửa"><Edit3 size={14} /></button>
      <button type="button" onClick={handleShare} aria-label="Chia sẻ" title="Chia sẻ"><Share2 size={14} /></button>
    </div></> : <><ToolExecutionSummary toolCalls={toolCalls} /><div className="assistant-content"><ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown></div></>}
  </div></article>;
}
