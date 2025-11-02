interface FloatingAIButtonProps {
  onClick: () => void;
}

export const FloatingAIButton = ({ onClick }: FloatingAIButtonProps) => {
  return (
    <div className="fixed top-20 right-8 z-50">
      <button 
        onClick={onClick} 
        aria-label="Open AI Task Creator" 
        className="w-14 h-14 sm:w-16 sm:h-16 rounded-full text-primary-foreground font-black text-2xl sm:text-3xl shadow-lg shadow-primary/30 hover:shadow-primary/50 hover:scale-105 transition-all duration-300 flex items-center justify-center border-2 border-primary-foreground/10 bg-primary"
      >
        P
      </button>
    </div>
  );
};