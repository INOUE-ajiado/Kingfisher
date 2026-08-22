import React from 'react';

interface LogoTitleProps {
  size?: 'sm' | 'md' | 'lg';
  showSubtitle?: boolean;
  className?: string;
}

export const LogoTitle: React.FC<LogoTitleProps> = ({
  size = 'sm',
  showSubtitle = false,
  className = '',
}) => {
  const fontSizeClass =
    size === 'lg' ? 'text-3xl' : size === 'md' ? 'text-xl' : 'text-[15px]';

  return (
    <div className={`flex flex-col items-center select-none ${className}`}>
      <div
        className={`main-title flex items-baseline justify-center leading-none font-black italic ${fontSizeClass}`}
        style={{
          fontFamily: "'Montserrat', 'Helvetica Neue', Arial, sans-serif",
          fontWeight: 900,
          background: 'linear-gradient(90deg, #2563EB, #009E9F)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          paddingRight: '2px',
        }}
      >
        <span
          className="accent-color"
          style={{
            fontSize: '0.65em',
            lineHeight: 1,
            display: 'inline-block',
            verticalAlign: 'text-top',
            position: 'relative',
            top: '0.18em',
            fontWeight: 900,
            marginRight: '2px',
            WebkitTextFillColor: '#F97316',
            WebkitTextStroke: size === 'lg' ? '2px #F97316' : '1.2px #F97316',
          }}
        >
          <sup>++</sup>
        </span>
        <span className="text-part1">KING</span>
        <span className="text-part2">FISHER</span>
        <span className="dots">..</span>
      </div>

      {showSubtitle && (
        <div
          className="sub-title text-[11px] text-slate-500 dark:text-slate-400 font-mono tracking-wider mt-1"
          style={{ fontFamily: "'Courier New', Consolas, monospace" }}
        >
          Ver 2.0 (Studio Ultimate)
        </div>
      )}
    </div>
  );
};
