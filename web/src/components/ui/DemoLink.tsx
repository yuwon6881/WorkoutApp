import { useState } from 'react';
import { ExternalLink, Play } from 'lucide-react';
import { Button } from './Button';
import { Modal } from './Modal';
import { getVideoEmbedInfo } from '../../lib/videoEmbed';
import './DemoLink.css';

type Props = { url?: string | null; exerciseName: string };

/// The demonstration video linked to an exercise. Instead of forcing navigation to a new tab
/// or launching an external app on mobile, it plays the demonstration inside an in-app modal
/// so the user can watch the movement cue and easily dismiss it to continue their workout.
export function DemoLink({ url, exerciseName }: Props) {
  const [open, setOpen] = useState(false);
  if (!url) return null;

  const embedInfo = getVideoEmbedInfo(url);

  return (
    <>
      <a
        className="button tertiary exercise-demo-pill"
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={event => {
          event.preventDefault();
          setOpen(true);
        }}
        title={`Watch demonstration of ${exerciseName}`}
        aria-label={`Watch a demonstration of ${exerciseName}`}
      >
        <Play size={12} className="demo-play-icon" aria-hidden="true" fill="currentColor" />
        <span>Demo</span>
      </a>

      {open && (
        <Modal
          title={exerciseName}
          wide
          onClose={() => setOpen(false)}
          className="demo-video-modal"
        >
          <div className="modal-body demo-video-body">
            {embedInfo.embedUrl ? (
              <div className="demo-video-player-wrap">
                <iframe
                  className="demo-video-iframe"
                  src={embedInfo.embedUrl}
                  title={`${exerciseName} demonstration`}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  // The app's same-origin referrer policy would hide the hosting page, and YouTube
                  // refuses to play an embed that cannot name it.
                  referrerPolicy="strict-origin-when-cross-origin"
                  allowFullScreen
                />
              </div>
            ) : (
              <div className="demo-fallback-card">
                <p>This demonstration guide is hosted on an external website.</p>
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="button secondary"
                >
                  <ExternalLink size={15} />
                  <span>Open guide in new tab</span>
                </a>
              </div>
            )}
          </div>
          <div className="modal-actions demo-modal-actions">
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="button tertiary"
              title="Open demonstration in a new tab"
            >
              <ExternalLink size={14} />
              <span>{embedInfo.platform === 'youtube' ? 'Watch on YouTube' : 'Open in new tab'}</span>
            </a>
            <Button variant="primary" onClick={() => setOpen(false)}>
              Done
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}
