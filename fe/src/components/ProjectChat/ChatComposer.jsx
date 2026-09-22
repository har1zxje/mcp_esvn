import { ChevronDown, Mic, Paperclip, Send, Settings2, Square } from 'lucide-react';
import { useRef, useState } from 'react';
import ContextWindow from './ContextWindow';

export default function ChatComposer({ value, setValue, onSend, onStop, isSending, servers, selectedServers, onToggleServer, placeholder, contextUsage, inputRef }) {
  const [open, setOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef(null);
  const valueAtStartRef = useRef('');

  const toggleVoiceInput = () => {
    if (isListening) {
      recognitionRef.current?.stop();
      return;
    }

    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) {
      window.alert('Trình duyệt chưa hỗ trợ nhập bằng giọng nói. Hãy dùng Chrome hoặc Edge.');
      return;
    }

    const recognition = new Recognition();
    recognition.lang = 'vi-VN';
    recognition.continuous = true;
    recognition.interimResults = true;
    valueAtStartRef.current = value;
    recognition.onresult = (event) => {
      let transcript = '';
      for (let index = 0; index < event.results.length; index += 1) {
        transcript += event.results[index][0].transcript;
      }
      setValue(`${valueAtStartRef.current} ${transcript}`.trim());
    };
    recognition.onerror = () => setIsListening(false);
    recognition.onend = () => {
      setIsListening(false);
      recognitionRef.current = null;
    };
    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
  };

  return <form className="project-composer" onSubmit={onSend}>
    <textarea ref={inputRef} value={value} onChange={(event) => setValue(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} placeholder={placeholder} rows={1} aria-label="Tin nhắn" />
    <div className="project-compose-row">
      <button type="button" className="composer-icon" title="Đính kèm" aria-label="Đính kèm"><Paperclip size={19} /></button>
      <button type="button" className="composer-icon" title="Tùy chọn" aria-label="Tùy chọn"><Settings2 size={18} /></button>
      <ContextWindow usage={contextUsage} open={contextOpen} onToggle={() => setContextOpen((current) => !current)} />
      <div className="mcp-selector-wrap"><button type="button" className="composer-mcp" onClick={() => setOpen((current) => !current)} aria-expanded={open}><span className="mcp-selector-mark">⌁</span>{selectedServers.length ? `${selectedServers.length} selected` : 'Chọn MCP'}<ChevronDown size={14} /></button>{open && <div className="mcp-popover">{servers.map((server) => <label key={server.name}><input type="checkbox" checked={selectedServers.includes(server.name)} onChange={() => onToggleServer(server.name)} /><span>{server.label || server.name}</span></label>)}</div>}</div>
      <span className="composer-hint">{selectedServers.length ? 'MCP được phép dùng trong tin nhắn này' : 'Chưa chọn MCP server'}</span>
      <button type="button" className={`composer-icon${isListening ? ' is-listening' : ''}`} onClick={toggleVoiceInput} title={isListening ? 'Dừng nhập bằng giọng nói' : 'Nhập bằng giọng nói'} aria-label={isListening ? 'Dừng nhập bằng giọng nói' : 'Nhập bằng giọng nói'} aria-pressed={isListening}><Mic size={19} /></button>
      <button className="send-button" type={isSending ? 'button' : 'submit'} onClick={isSending ? onStop : undefined} disabled={!isSending && !value.trim()} title={isSending ? 'Dừng tạo câu trả lời' : 'Gửi'} aria-label={isSending ? 'Dừng tạo câu trả lời' : 'Gửi'}>{isSending ? <Square size={14} fill="currentColor" /> : <Send size={16} />}</button>
    </div>
  </form>;
}
