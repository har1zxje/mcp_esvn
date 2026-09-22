import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Copy, Edit3, Share2, Volume2 } from 'lucide-react';
import ToolExecutionSummary from './ToolExecutionSummary';

export default function ProjectMessage({ message, toolCalls, modelLabel }) {
  const isUser = message.role === 'user';
  return <article className={`project-message ${isUser ? 'user' : 'assistant'}`}>
    <div className="project-message-body">{!isUser && <div className="message-meta"><strong>{modelLabel || 'Gemini'}</strong><time>now</time></div>}{isUser ? <><div className="user-bubble"><ReactMarkdown remarkPlugins={[remarkGfm]}>{message.text || ''}</ReactMarkdown></div><div className="message-actions"><button type="button" aria-label="Đọc tin nhắn" title="Đọc tin nhắn"><Volume2 size={14} /></button><button type="button" aria-label="Sao chép" title="Sao chép"><Copy size={14} /></button><button type="button" aria-label="Chỉnh sửa" title="Chỉnh sửa"><Edit3 size={14} /></button><button type="button" aria-label="Chia sẻ" title="Chia sẻ"><Share2 size={14} /></button></div></> : <><ToolExecutionSummary toolCalls={toolCalls} /><div className="assistant-content"><ReactMarkdown remarkPlugins={[remarkGfm]}>{message.text || ''}</ReactMarkdown></div></>}</div>
  </article>;
}
