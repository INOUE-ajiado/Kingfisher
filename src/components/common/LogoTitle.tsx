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
  const fontSizeStyle =
    size === 'lg'
      ? { fontSize: '32px' }
      : size === 'md'
      ? { fontSize: '24px' }
      : { fontSize: '15px' };

  return (
    <div className={`theme-speed-logo inline-flex flex-col items-center select-none ${className}`}>
      <div className="main-title" style={fontSizeStyle}>
        <span className="accent-color">
          <sup>++</sup>
        </span>
        <span className="text-part1">KING</span>
        <span className="text-part2">FISHER</span>
        <span className="dots">..</span>
      </div>
      {showSubtitle && <div className="sub-title">Ver 2.0 (Studio Ultimate)</div>}
    </div>
  );
};
