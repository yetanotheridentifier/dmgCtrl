import userGuideHtml from '../../docs/userGuide.md'
import { BUILD_TAG } from '../buildTag'
import { isDev } from '../env'

interface Props {
  onBack: () => void
}

// The guide's own <h1> is dropped — the screen renders its own header row,
// matching the main app's help screen behaviour.
const contentHtml = userGuideHtml.replace(/^<h1[^>]*>[\s\S]*?<\/h1>\n?/, '')

export default function HelpScreen({ onBack }: Props) {
  return (
    <div data-testid="help-screen" className="max-w-3xl">
      <div className="flex items-center gap-4">
        <button
          onClick={onBack}
          aria-label="Back"
          className="w-9 h-9 flex items-center justify-center border-2 border-line rounded-lg text-ink-dim hover:text-ink shadow-[0_0_8px_rgba(156,163,175,0.2)]"
        >
          ‹
        </button>
        <h2 className="text-accent text-sm uppercase tracking-[0.12em] font-light">Help</h2>
      </div>
      <div
        data-testid="help-content"
        className="help-content mt-4 text-ink-body text-sm leading-relaxed space-y-3"
        dangerouslySetInnerHTML={{ __html: contentHtml }}
      />
      {/* Build marker lives here in prod; in dev it's a corner badge. */}
      {!isDev() && (
        <p data-testid="build-tag" className="mt-8 text-[10px] text-ink-faint">
          {BUILD_TAG}
        </p>
      )}
    </div>
  )
}
