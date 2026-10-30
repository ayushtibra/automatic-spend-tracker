import { useEffect, useState } from 'react';
import { isVoiceAvailable, listenOnce, VoiceCancelled } from '../lib/voice';

interface Props {
  /** Called with the typed / spoken / pasted text. */
  onSubmit: (text: string) => void;
  autoFocus?: boolean;
  /** Start listening as soon as the bar appears. */
  startListening?: boolean;
}

/** One box for everything: type "220 zepto groceries hsbc", tap 🎤 and say it, or paste a bank SMS. */
export default function QuickAddBar({ onSubmit, autoFocus, startListening }: Props) {
  const [text, setText] = useState('');
  const [voice, setVoice] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    isVoiceAvailable().then((ok) => {
      setVoice(ok);
      if (ok && startListening) speak();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = (value: string) => {
    const v = value.trim();
    if (!v) return;
    onSubmit(v);
    setText('');
  };

  const speak = async () => {
    setError('');
    setListening(true);
    try {
      const said = await listenOnce();
      setText(said);
      submit(said);
    } catch (e) {
      if (!(e instanceof VoiceCancelled)) setError((e as Error).message);
    } finally {
      setListening(false);
    }
  };

  return (
    <div className="quick-add">
      {/* Not a <form>: this bar also sits inside the entry form, and forms can't nest. */}
      <div className="quick-add-row">
        <textarea
          rows={1}
          autoFocus={autoFocus}
          enterKeyHint="go"
          placeholder={listening ? 'Listening…' : 'Type or say: 220 zepto groceries hsbc card'}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit(text);
            }
          }}
          aria-label="Quick add: type, speak or paste a bank SMS"
        />
        {voice && (
          <button type="button" className={`icon-btn mic ${listening ? 'live' : ''}`} aria-label="Speak the spend" onClick={speak} disabled={listening}>
            🎤
          </button>
        )}
        <button type="button" className="icon-btn go" aria-label="Fill details" disabled={!text.trim()} onClick={() => submit(text)}>
          ➜
        </button>
      </div>
      {error && <p className="error small">{error}</p>}
    </div>
  );
}
