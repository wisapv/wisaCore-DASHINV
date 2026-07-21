import React from 'react';

// Small accent diamond used in the logo mark, header, and page titles across
// the restyled pages. Purely decorative.
const Sparkle = ({ size = 16, delay = '0s', className = '' }) => (
  <div
    className={`bg-accent animate-sparkle ${className}`}
    style={{
      width: size,
      height: size,
      clipPath: 'polygon(50% 0%,61% 39%,100% 50%,61% 61%,50% 100%,39% 61%,0% 50%,39% 39%)',
      animationDelay: delay,
    }}
  />
);

export default Sparkle;
