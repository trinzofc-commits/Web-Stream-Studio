import { createContext, useContext, useState, ReactNode } from 'react';

type StudioContextType = {
  activeProjectId: number | null;
  setActiveProjectId: (id: number | null) => void;
  activeSceneId: number | null;
  setActiveSceneId: (id: number | null) => void;
  activeSourceId: number | null;
  setActiveSourceId: (id: number | null) => void;
};

const StudioContext = createContext<StudioContextType | undefined>(undefined);

export function StudioProvider({ children }: { children: ReactNode }) {
  const [activeProjectId, setActiveProjectId] = useState<number | null>(null);
  const [activeSceneId, setActiveSceneId] = useState<number | null>(null);
  const [activeSourceId, setActiveSourceId] = useState<number | null>(null);

  return (
    <StudioContext.Provider
      value={{
        activeProjectId,
        setActiveProjectId,
        activeSceneId,
        setActiveSceneId,
        activeSourceId,
        setActiveSourceId,
      }}
    >
      {children}
    </StudioContext.Provider>
  );
}

export function useStudio() {
  const context = useContext(StudioContext);
  if (context === undefined) {
    throw new Error('useStudio must be used within a StudioProvider');
  }
  return context;
}
