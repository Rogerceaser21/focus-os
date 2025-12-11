const SafariBackground = () => {
  return (
    <div
      style={{
        position: 'fixed',
        top: '-200px',
        left: '-200px',
        right: '-200px',
        bottom: '-200px',
        backgroundColor: 'hsl(0 0% 5%)',
        zIndex: -9999,
        pointerEvents: 'none',
      }}
      aria-hidden="true"
    />
  );
};

export default SafariBackground;
