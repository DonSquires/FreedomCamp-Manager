/**
 * PaperworkSearchAnimation Component
 * An animated cartoon of a person searching through paperwork,
 * used as a loading indicator while data is being fetched.
 */

interface PaperworkSearchAnimationProps {
  text?: string
  size?: 'sm' | 'md' | 'lg'
}

export function PaperworkSearchAnimation({
  text = 'Searching records…',
  size = 'md',
}: PaperworkSearchAnimationProps) {
  const sizeMap = { sm: 120, md: 180, lg: 240 }
  const dim = sizeMap[size]
  const textSize = size === 'sm' ? 'text-xs' : size === 'md' ? 'text-sm' : 'text-base'

  return (
    <div className="flex flex-col items-center justify-center gap-3 p-6">
      <svg
        width={dim}
        height={dim}
        viewBox="0 0 200 200"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-label="Loading animation"
        role="img"
      >
        {/* Desk */}
        <rect x="20" y="140" width="160" height="8" rx="3" fill="#d4a574" />
        <rect x="30" y="148" width="6" height="30" rx="2" fill="#c4956a" />
        <rect x="164" y="148" width="6" height="30" rx="2" fill="#c4956a" />

        {/* Paper stack (left) — slight shuffle animation */}
        <g>
          <rect x="30" y="118" width="40" height="22" rx="2" fill="#f0ebe3" stroke="#d1ccc4" strokeWidth="0.5">
            <animateTransform
              attributeName="transform"
              type="translate"
              values="0,0; -1,-1; 0,0; 1,0; 0,0"
              dur="2s"
              repeatCount="indefinite"
            />
          </rect>
          <line x1="35" y1="124" x2="60" y2="124" stroke="#c8c0b8" strokeWidth="1" />
          <line x1="35" y1="128" x2="55" y2="128" stroke="#c8c0b8" strokeWidth="1" />
          <line x1="35" y1="132" x2="62" y2="132" stroke="#c8c0b8" strokeWidth="1" />
        </g>

        {/* Paper stack (right) */}
        <g>
          <rect x="130" y="122" width="40" height="18" rx="2" fill="#f5f0e8" stroke="#d1ccc4" strokeWidth="0.5" />
          <line x1="135" y1="128" x2="160" y2="128" stroke="#c8c0b8" strokeWidth="1" />
          <line x1="135" y1="132" x2="155" y2="132" stroke="#c8c0b8" strokeWidth="1" />
        </g>

        {/* Scattered papers in-between */}
        <rect x="75" y="126" width="30" height="14" rx="1" fill="#fcf8f2" stroke="#d8d0c6" strokeWidth="0.5">
          <animateTransform
            attributeName="transform"
            type="rotate"
            values="-3,90,133; 2,90,133; -3,90,133"
            dur="3s"
            repeatCount="indefinite"
          />
        </rect>
        <rect x="80" y="128" width="28" height="12" rx="1" fill="#f7f2ea" stroke="#d8d0c6" strokeWidth="0.5">
          <animateTransform
            attributeName="transform"
            type="rotate"
            values="5,94,134; -2,94,134; 5,94,134"
            dur="2.5s"
            repeatCount="indefinite"
          />
        </rect>

        {/* Person — body */}
        {/* Torso */}
        <rect x="85" y="70" width="30" height="40" rx="6" fill="#4a90d9" />
        {/* Collar */}
        <path d="M93 70 L100 78 L107 70" fill="#3b7bc8" />

        {/* Head */}
        <circle cx="100" cy="55" r="16" fill="#f5c9a0" />
        {/* Hair */}
        <path
          d="M84 50 Q84 38, 100 36 Q116 38, 116 50 L116 46 Q116 34, 100 32 Q84 34, 84 46 Z"
          fill="#5c3d2e"
        />
        {/* Eye */}
        <circle cx="95" cy="54" r="1.5" fill="#333">
          <animate attributeName="cy" values="54;55;54" dur="2s" repeatCount="indefinite" />
        </circle>
        <circle cx="105" cy="54" r="1.5" fill="#333">
          <animate attributeName="cy" values="54;55;54" dur="2s" repeatCount="indefinite" />
        </circle>
        {/* Mouth — slight smile */}
        <path d="M96 61 Q100 64, 104 61" stroke="#333" strokeWidth="1" fill="none" />

        {/* Left arm — resting on desk */}
        <path d="M85 80 Q70 95, 55 120" stroke="#4a90d9" strokeWidth="8" strokeLinecap="round" fill="none" />
        {/* Left hand */}
        <circle cx="55" cy="122" r="5" fill="#f5c9a0" />

        {/* Right arm — picking up / putting down paper */}
        <g>
          <animateTransform
            attributeName="transform"
            type="rotate"
            values="0,115,80; -12,115,80; 0,115,80; 8,115,80; 0,115,80"
            dur="2s"
            repeatCount="indefinite"
          />
          <path d="M115 80 Q130 95, 140 115" stroke="#4a90d9" strokeWidth="8" strokeLinecap="round" fill="none" />
          {/* Right hand */}
          <circle cx="140" cy="117" r="5" fill="#f5c9a0" />
          {/* Paper being held */}
          <rect x="132" y="108" width="18" height="14" rx="1" fill="#fff" stroke="#ccc" strokeWidth="0.5">
            <animate attributeName="opacity" values="1;1;0.3;1;1" dur="2s" repeatCount="indefinite" />
          </rect>
          <line x1="135" y1="113" x2="146" y2="113" stroke="#ddd" strokeWidth="0.8" />
          <line x1="135" y1="117" x2="143" y2="117" stroke="#ddd" strokeWidth="0.8" />
        </g>

        {/* Flying paper — tossed aside */}
        <g>
          <animateTransform
            attributeName="transform"
            type="translate"
            values="0,0; -15,-30; -25,-10; -15,5; 0,0"
            dur="3s"
            repeatCount="indefinite"
          />
          <rect x="60" y="95" width="16" height="12" rx="1" fill="#fff" stroke="#ccc" strokeWidth="0.5">
            <animateTransform
              attributeName="transform"
              type="rotate"
              values="0,68,101; -20,68,101; 15,68,101; 0,68,101"
              dur="3s"
              repeatCount="indefinite"
            />
            <animate attributeName="opacity" values="0;0.8;1;0.6;0" dur="3s" repeatCount="indefinite" />
          </rect>
        </g>

        {/* Magnifying glass near desk — bobbing */}
        <g>
          <animateTransform
            attributeName="transform"
            type="translate"
            values="0,0; 2,-3; 0,0; -2,-2; 0,0"
            dur="1.8s"
            repeatCount="indefinite"
          />
          <circle cx="48" cy="108" r="8" stroke="#6b7280" strokeWidth="2.5" fill="none" opacity="0.7" />
          <line x1="54" y1="114" x2="60" y2="120" stroke="#6b7280" strokeWidth="2.5" strokeLinecap="round" opacity="0.7" />
          {/* Glare on lens */}
          <path d="M44 104 Q46 102, 48 104" stroke="#fff" strokeWidth="1" fill="none" opacity="0.5" />
        </g>
      </svg>

      {text && (
        <p className={`${textSize} text-muted-foreground animate-pulse`}>
          {text}
        </p>
      )}
    </div>
  )
}
