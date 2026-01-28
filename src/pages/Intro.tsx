import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

const Intro = () => {
  const navigate = useNavigate();

  useEffect(() => {
    navigate('/', { replace: true });
  }, [navigate]);

  return null;
};

export default Intro;
