import { useEffect, useRef, useState, type DragEvent } from 'react';
import { AlertTriangle, ClipboardCopy, ClipboardPaste, FileJson, Trash2, UploadCloud, X } from 'lucide-react';
import { ApiError, api } from '../lib/api';
import { correctionRequest, describeFailure, type ExternalImportPrompt } from '../lib/externalImport';
import { Button } from './ui/Button';
import { LiftLoader } from './ui/LiftLoader';
import { SegmentedControl } from './ui/SegmentedControl';
import type { ExternalImportFailure, ImportProgress } from './useImportPipeline';
import './ImportExternalPanel.css';

type CopyState = 'idle' | 'copied' | 'manual' | 'failed';
type Mode = 'file' | 'paste';

const MODES = [
  { value: 'file', label: 'Upload a file' },
  { value: 'paste', label: 'Paste the JSON' }
] as const;

/// Writes to the clipboard where the browser allows it; the caller falls back to showing the text.
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

const formatSize = (text: string) => {
  const bytes = new TextEncoder().encode(text).length;
  return bytes < 1024 ? `${bytes} bytes` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

/// The AI-assisted import: copy the prompt, give the document to an AI assistant, then upload the JSON
/// it returns, as a file, by dropping it, or by pasting the text. WorkoutApp never sees the original
/// document, so the panel says plainly that the JSON is checked for structure only.
export function ImportExternalPanel({ busy, failure, progress, onChooseFile, onDropFile, onSubmitText, onDismissFailure }: {
  busy: boolean;
  failure: ExternalImportFailure | null;
  progress: ImportProgress | null;
  onChooseFile: () => void;
  /// A file dropped on the panel goes the same way as a chosen one, through the same checks.
  onDropFile: (file: File) => void;
  /// JSON text pasted instead of a file.
  onSubmitText: (text: string) => void;
  onDismissFailure: () => void;
}) {
  const [prompt, setPrompt] = useState<ExternalImportPrompt | null>(null);
  const [promptState, setPromptState] = useState<CopyState>('idle');
  const [promptError, setPromptError] = useState('');
  const [errorsState, setErrorsState] = useState<CopyState>('idle');
  const [mode, setMode] = useState<Mode>('file');
  const [pasted, setPasted] = useState('');
  const [pasteHint, setPasteHint] = useState('');
  const [dropping, setDropping] = useState(false);
  // One reset timer per button: sharing one let copying the errors cancel the prompt's reset.
  const promptTimer = useRef<number | undefined>(undefined);
  const errorsTimer = useRef<number | undefined>(undefined);

  useEffect(() => () => {
    window.clearTimeout(promptTimer.current);
    window.clearTimeout(errorsTimer.current);
  }, []);
  useEffect(() => { setErrorsState('idle'); }, [failure]);

  const settle = (timer: { current: number | undefined }, set: (state: CopyState) => void, state: CopyState) => {
    set(state);
    window.clearTimeout(timer.current);
    if (state === 'copied') timer.current = window.setTimeout(() => set('idle'), 2500);
  };

  async function copyPrompt() {
    setPromptError('');
    let loaded = prompt;
    if (!loaded) {
      try { loaded = await api.externalImportPrompt(); setPrompt(loaded); }
      catch (error) {
        setPromptError(error instanceof ApiError ? error.message : 'The prompt could not be loaded. Try again.');
        return;
      }
    }
    settle(promptTimer, setPromptState, await copyText(loaded.prompt) ? 'copied' : 'manual');
  }

  async function copyErrors() {
    if (!failure) return;
    const text = failure.errors.length > 0
      ? correctionRequest(failure.errors, prompt?.version, failure.excerpt)
      : failure.message;
    settle(errorsTimer, setErrorsState, await copyText(text) ? 'copied' : 'failed');
  }

  async function pasteFromClipboard() {
    setPasteHint('');
    try {
      setPasted(await navigator.clipboard.readText());
    } catch {
      setPasteHint('Your browser blocked reading the clipboard. Click in the box and press Ctrl+V (Cmd+V on a Mac).');
    }
  }

  const accepts = (event: DragEvent) => !busy && event.dataTransfer.types.includes('Files');
  const drop = {
    onDragOver: (event: DragEvent<HTMLElement>) => {
      if (!accepts(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
      setDropping(true);
    },
    onDragLeave: (event: DragEvent<HTMLElement>) => {
      // Moving between the panel's own children also fires a leave; only leaving the panel counts.
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropping(false);
    },
    onDrop: (event: DragEvent<HTMLElement>) => {
      setDropping(false);
      if (!accepts(event)) return;
      event.preventDefault();
      const dropped = event.dataTransfer.files[0];
      if (dropped) onDropFile(dropped);
    }
  };
  const shown = failure ? describeFailure(failure) : null;

  return (
    <section className={`panel iep-panel${dropping ? ' iep-dropping' : ''}`} aria-labelledby="iep-title" {...drop}>
      <div className="iep-head">
        <h2 id="iep-title" className="iep-title">Import with an AI assistant</h2>
        <p className="muted small-copy">
          An AI assistant reads your PDF, Excel file or other program document and returns a JSON file to add here.
        </p>
      </div>

      <ol className="iep-steps">
        <li className="iep-step">
          <span className="iep-step-badge" aria-hidden="true">1</span>
          <div className="iep-step-body">
            <span className="iep-step-text">Copy the prompt</span>
            <div className="iep-actions">
              <Button variant="secondary" onClick={() => void copyPrompt()}>
                <ClipboardCopy size={15} aria-hidden="true" />
                {promptState === 'copied' ? 'Prompt copied' : 'Copy prompt'}
              </Button>
            </div>
            <span className="iep-status" role="status">
              {promptState === 'copied' ? 'The prompt is on your clipboard.' : ''}
            </span>
            {promptError && <p className="iep-inline-error" role="alert">{promptError}</p>}
            {promptState === 'manual' && prompt && (
              <label className="iep-manual">
                <span className="small-copy">Your browser blocked copying. Select and copy this text instead.</span>
                <textarea readOnly value={prompt.prompt} rows={6} onFocus={event => event.currentTarget.select()} />
              </label>
            )}
          </div>
        </li>
        <li className="iep-step">
          <span className="iep-step-badge" aria-hidden="true">2</span>
          <div className="iep-step-body">
            <span className="iep-step-text">Give your AI assistant the prompt and your document</span>
            <span className="muted small-copy">
              Attach the document in its chat, paste the prompt, answer its questions, and download the JSON it produces.
            </span>
          </div>
        </li>
        <li className="iep-step">
          <span className="iep-step-badge" aria-hidden="true">3</span>
          <div className="iep-step-body">
            <span className="iep-step-text">Add the JSON</span>
            <span className="muted small-copy">
              WorkoutApp checks the JSON&apos;s structure, not your original document. You review every day and
              exercise before the program is created.
            </span>
            <SegmentedControl<Mode> label="How to add the JSON" value={mode} options={MODES} onChange={setMode}
              className="iep-mode" disabled={busy} />

            {mode === 'file' ? (
              <div className={`iep-dropzone${dropping ? ' is-active' : ''}`} role="group" aria-label="Drop a JSON file here">
                <UploadCloud size={28} aria-hidden="true" className="iep-dropzone-icon" />
                <span className="iep-dropzone-title">{dropping ? 'Release to upload' : 'Drop your JSON file here'}</span>
                <Button variant="primary" disabled={busy} onClick={onChooseFile}>
                  <FileJson size={16} aria-hidden="true" />
                  Choose a JSON file
                </Button>
                <span className="muted small-copy">.json · up to 8 MB</span>
              </div>
            ) : (
              <div className="iep-paste">
                <div className="iep-paste-field">
                  <textarea className="iep-paste-input" value={pasted} rows={10} spellCheck={false} autoComplete="off"
                    aria-label="JSON to import" placeholder="Paste the whole JSON here, from the opening { to the closing }"
                    onChange={event => { setPasted(event.target.value); setPasteHint(''); }} />
                </div>
                <div className="iep-paste-bar">
                  <span className="muted small-copy iep-paste-size" aria-live="polite">
                    {pasted.trim() === '' ? '' : formatSize(pasted)}
                  </span>
                  <div className="iep-paste-actions">
                    <Button variant="tertiary" disabled={busy} onClick={() => void pasteFromClipboard()}>
                      <ClipboardPaste size={15} aria-hidden="true" />
                      Paste from clipboard
                    </Button>
                    <Button variant="tertiary" disabled={busy || pasted === ''} onClick={() => { setPasted(''); setPasteHint(''); }}>
                      <Trash2 size={15} aria-hidden="true" />
                      Clear
                    </Button>
                    <Button variant="primary" disabled={busy || pasted.trim() === ''} onClick={() => onSubmitText(pasted)}>
                      Check pasted JSON
                    </Button>
                  </div>
                </div>
                {pasteHint && <p className="iep-inline-error" role="status">{pasteHint}</p>}
              </div>
            )}
            {progress && <p className="iep-status iep-status-busy" role="status"><LiftLoader size="sm" />{progress.label}: {progress.detail}</p>}
          </div>
        </li>
      </ol>

      {failure && shown && (
        <div className="iep-failure" role="alert">
          <div className="iep-failure-head">
            <AlertTriangle size={16} aria-hidden="true" />
            <p className="iep-failure-message">{shown.headline}</p>
            <Button variant="tertiary" aria-label="Dismiss this message" onClick={onDismissFailure}>
              <X size={16} aria-hidden="true" />
            </Button>
          </div>
          {failure.excerpt && (
            <div className="iep-excerpt">
              <span className="small-copy">Line {failure.excerpt.line}, near column {failure.excerpt.column} of your file:</span>
              <pre className="iep-excerpt-code"><code>{failure.excerpt.snippet}{'\n'}<span aria-hidden="true">{' '.repeat(failure.excerpt.caret)}^</span></code></pre>
            </div>
          )}
          {shown.items.length > 0 && (
            <ul className="iep-error-list">
              {shown.items.map((error, index) => (
                <li key={`${error.path}:${index}`}>
                  <code className="iep-error-path">{error.path}</code>
                  <span className="iep-error-message">{error.message}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="iep-actions iep-actions--end">
            <Button variant="secondary" onClick={() => void copyErrors()}>
              <ClipboardCopy size={15} aria-hidden="true" />
              {errorsState === 'copied' ? 'Copied' : failure.errors.length > 0 ? 'Copy errors for your AI assistant' : 'Copy message'}
            </Button>
            <Button variant="secondary" disabled={busy} onClick={mode === 'file' ? onChooseFile : () => setMode('file')}>
              {mode === 'file' ? 'Choose another file' : 'Upload a file instead'}
            </Button>
          </div>
          <span className="iep-status" role="status">
            {errorsState === 'copied' ? 'Paste it into the same chat and ask for the corrected file.'
              : errorsState === 'failed' ? 'Your browser blocked copying. Select the errors above and copy them.' : ''}
          </span>
        </div>
      )}
    </section>
  );
}
