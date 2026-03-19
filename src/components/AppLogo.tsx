import { useNavigate } from 'react-router-dom';

const AppLogo = ({ className = '' }: { className?: string }) => {
  const navigate = useNavigate();

  return (
    <button
      onClick={() => navigate('/home')}
      className={`text-sm font-bold text-muted-foreground hover:text-foreground transition-colors tracking-tight ${className}`}
      title="Back to Home"
    >
      Focus OS
    </button>
  );
};

export default AppLogo;
