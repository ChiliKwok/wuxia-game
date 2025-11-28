import React, { useState, useEffect, useRef } from 'react';
import { SectId, SectInfo, GameState, GamePhase, SectState, InteractionState, InteractionType, LogEntry, Point, LocationData } from './types';
import { SECTS, MAX_DAYS, GOAL_PROGRESS, SECT_ORDER, WEATHERS, FIXED_LOCATIONS } from './constants';
import * as GeminiService from './services/geminiService';

// --- Helper Functions ---

// Convert file to Base64 string for persistent storage in JSON
const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = error => reject(error);
  });
};

// --- Helper Components ---

const Button: React.FC<{ 
  onClick: () => void; 
  children: React.ReactNode; 
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  className?: string;
  icon?: React.ReactNode;
  style?: React.CSSProperties;
}> = ({ onClick, children, disabled, variant = 'primary', className = '', icon, style }) => {
  const baseStyle = "relative px-4 py-2 font-serif font-bold transition-all duration-300 overflow-hidden border select-none disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2";
  
  const variants = {
    primary: "text-stone-900 bg-gold hover:bg-yellow-500 border-gold shadow-[0_2px_10px_rgba(197,160,89,0.2)]",
    secondary: "text-gold border-gold bg-stone-900 hover:bg-gold/10",
    danger: "text-white bg-crimson border-crimson hover:bg-red-800",
    ghost: "text-stone-400 border-transparent hover:text-gold hover:bg-stone-800"
  };

  return (
    <button onClick={onClick} disabled={disabled} style={style} className={`${baseStyle} ${variants[variant]} ${className}`}>
      {icon}
      {children}
    </button>
  );
};

const StatInput: React.FC<{
  label: string;
  value: number;
  onChange: (val: number) => void;
  color?: string;
}> = ({ label, value, onChange, color = "text-stone-300" }) => (
  <div className="flex justify-between items-center border-b border-stone-800/50 pb-1">
      <span className="text-stone-500 text-sm">{label}</span>
      <input 
        type="number"
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value) || 0)}
        className={`bg-transparent text-right font-mono w-16 focus:outline-none focus:border-b focus:border-gold ${color}`}
      />
  </div>
);

// --- Path Logic Helpers ---
const getDistance = (p1: Point, p2: Point) => {
    const dx = p1.x - p2.x;
    const dy = p1.y - p2.y;
    return Math.sqrt(dx * dx + dy * dy);
};

const getPathLength = (path: Point[]) => {
    if (path.length < 2) return 0;
    let total = 0;
    for (let i = 0; i < path.length - 1; i++) {
        total += getDistance(path[i], path[i+1]);
    }
    return total;
};

// Map progress (0-120) to path percentage (0-100%) for visualization
const getPathPosition = (progressVal: number, path: Point[] | undefined): { left: string, top: string } => {
    // Normalize progress (0-120) to percentage (0-100)
    const percentage = Math.min(100, Math.max(0, (progressVal / GOAL_PROGRESS) * 100));

    if (!path || path.length < 2) {
        return { left: `${percentage}%`, top: '50%' };
    }
    
    const totalLen = getPathLength(path);
    if (totalLen === 0) return { left: `${path[0].x}%`, top: `${path[0].y}%` };
    
    const targetDist = (percentage / 100) * totalLen;
    let currentDist = 0;
    
    for (let i = 0; i < path.length - 1; i++) {
        const p1 = path[i];
        const p2 = path[i+1];
        const segDist = getDistance(p1, p2);
        if (currentDist + segDist >= targetDist) {
            const remaining = targetDist - currentDist;
            const ratio = remaining / segDist;
            const x = p1.x + (p2.x - p1.x) * ratio;
            const y = p1.y + (p2.y - p1.y) * ratio;
            return { left: `${x}%`, top: `${y}%` };
        }
        currentDist += segDist;
    }
    const last = path[path.length - 1];
    return { left: `${last.x}%`, top: `${last.y}%` };
};

// --- Main App ---

const App: React.FC = () => {
  // State
  const [apiKey, setApiKey] = useState<string>('');
  const [showApiKeyModal, setShowApiKeyModal] = useState<boolean>(!process.env.API_KEY);
  const [phase, setPhase] = useState<GamePhase>(GamePhase.INTRO);
  const [loading, setLoading] = useState<boolean>(false);
  
  // Customization State (Setup Phase)
  const [tempMapBg, setTempMapBg] = useState<string | null>(null);
  const [tempPath, setTempPath] = useState<Point[]>([]);
  const [isDrawingPath, setIsDrawingPath] = useState<boolean>(false);
  const [tempSectImages, setTempSectImages] = useState<Record<string, string>>({});
  const [tempSectPortraits, setTempSectPortraits] = useState<Record<string, string>>({});
  
  const [uploadingSectId, setUploadingSectId] = useState<string | null>(null);
  const [uploadingType, setUploadingType] = useState<'TOKEN' | 'PORTRAIT' | null>(null);

  // Interaction State (Modal)
  const [interaction, setInteraction] = useState<InteractionState | null>(null);
  
  // DM Inputs
  const [interactionValue, setInteractionValue] = useState<string>("5");
  const [interactionStats, setInteractionStats] = useState({
    martial: 0, strategy: 0, wealth: 0, prestige: 0
  });
  // New Complex Interaction Mechanics
  const [applySkipTurn, setApplySkipTurn] = useState<boolean>(false);
  const [applyActionAgain, setApplyActionAgain] = useState<boolean>(false);

  // Detail Modal State
  const [viewingSectDetail, setViewingSectDetail] = useState<SectId | null>(null);

  // DM Input for Movement
  const [dmInputValue, setDmInputValue] = useState<string>("5"); 
  
  // File Input Refs
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mapInputRef = useRef<HTMLInputElement>(null);
  const sectImageInputRef = useRef<HTMLInputElement>(null);

  // Game Data
  const [gameState, setGameState] = useState<GameState>({
    day: 1,
    weather: WEATHERS[0],
    activeSectIndex: 0,
    turnQueue: SECT_ORDER,
    isDayComplete: false,
    sectStates: {} as Record<SectId, SectState>,
    globalLog: []
  });

  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (process.env.API_KEY) {
      setApiKey(process.env.API_KEY);
      setShowApiKeyModal(false);
    }
  }, []);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [gameState.globalLog]);

  const startSetup = () => {
      setPhase(GamePhase.SETUP);
  };

  const getRandomWeather = () => {
      return WEATHERS[Math.floor(Math.random() * WEATHERS.length)];
  };

  // *** FIXED MAP LOOKUP ***
  const getLocationData = (progress: number): LocationData => {
      // Ensure index is within bounds [0, 120]
      const index = Math.min(GOAL_PROGRESS, Math.max(0, Math.floor(progress)));
      return FIXED_LOCATIONS[index] || FIXED_LOCATIONS[0];
  };

  const initializeGame = () => {
    const startLoc = getLocationData(0);
    const initialSects: any = {};
    SECT_ORDER.forEach(id => {
        initialSects[id] = {
            id,
            locationProgress: 0,
            currentLocationName: startLoc.name,
            stats: { martial: 20, strategy: 20, wealth: 20, prestige: 0 },
            history: [],
            visitedLocations: [startLoc.name],
            lastMoveDesc: '蓄势待发',
            skipNextTurn: false,
        };
    });
    
    setGameState(prev => ({
        ...prev,
        day: 1,
        weather: getRandomWeather(),
        activeSectIndex: 0,
        turnQueue: SECT_ORDER,
        isDayComplete: false,
        sectStates: initialSects,
        globalLog: [{ day: 1, type: 'system', content: '七曜同宫，逆鳞现世。七大门派整装待发。' }],
        customMapBg: tempMapBg || undefined,
        customPath: tempPath.length > 1 ? tempPath : undefined,
        customSectImages: tempSectImages,
        customSectPortraits: tempSectPortraits
    }));
    setPhase(GamePhase.MAIN_LOOP);
    setInteraction(null);
  };

  // --- Handlers ---
  const handleSetupMapClick = (e: React.MouseEvent<HTMLDivElement>) => {
      if (!isDrawingPath) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 100;
      const y = ((e.clientY - rect.top) / rect.height) * 100;
      setTempPath(prev => [...prev, { x, y }]);
  };

  const handleSaveGame = () => {
      const dataStr = JSON.stringify(gameState, null, 2);
      const blob = new Blob([dataStr], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `七曜逆鳞_第${gameState.day}日.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
  };
  const handleLoadGameClick = () => fileInputRef.current?.click();
  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (e) => {
          try {
              const json = e.target?.result as string;
              const loadedState = JSON.parse(json);
              if (!loadedState.sectStates || !loadedState.globalLog) throw new Error("Invalid format");
              setGameState(loadedState);
              // Sync temp state
              if (loadedState.customMapBg) setTempMapBg(loadedState.customMapBg);
              if (loadedState.customPath) setTempPath(loadedState.customPath);
              if (loadedState.customSectImages) setTempSectImages(loadedState.customSectImages);
              if (loadedState.customSectPortraits) setTempSectPortraits(loadedState.customSectPortraits);
              if (phase === GamePhase.INTRO) setPhase(GamePhase.MAIN_LOOP);
              setInteraction(null); setViewingSectDetail(null); setLoading(false);
              alert("读取成功！");
          } catch (err) { alert("存档错误。"); }
      };
      reader.readAsText(file);
      event.target.value = '';
  };
  
  // --- Updated Image Upload Handlers (Base64) ---
  const handleMapUploadClick = () => mapInputRef.current?.click();
  
  const handleMapFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;
      
      try {
          const base64 = await fileToBase64(file);
          if (phase === GamePhase.SETUP) {
              setTempMapBg(base64);
          } else {
              setGameState(prev => ({ ...prev, customMapBg: base64 }));
          }
      } catch (e) {
          console.error("Image upload failed", e);
          alert("图片处理失败，请重试");
      }
      event.target.value = '';
  };

  const handleSectImageClick = (sectId: string, type: 'TOKEN' | 'PORTRAIT') => {
      setUploadingSectId(sectId); setUploadingType(type);
      setTimeout(() => sectImageInputRef.current?.click(), 0);
  };

  const handleSectImageChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file || !uploadingSectId || !uploadingType) return;

      try {
          const base64 = await fileToBase64(file);
          if (uploadingType === 'TOKEN') {
              setTempSectImages(prev => ({ ...prev, [uploadingSectId]: base64 }));
          } else {
              setTempSectPortraits(prev => ({ ...prev, [uploadingSectId]: base64 }));
          }
      } catch (e) {
          console.error("Image upload failed", e);
          alert("图片处理失败，请重试");
      }
      
      event.target.value = '';
      setUploadingSectId(null); setUploadingType(null);
  };

  const handleStatEdit = (sectId: SectId, statName: keyof SectState['stats'], newValue: number) => {
    setGameState(prev => ({
        ...prev,
        sectStates: {
            ...prev.sectStates,
            [sectId]: {
                ...prev.sectStates[sectId],
                stats: { ...prev.sectStates[sectId].stats, [statName]: newValue }
            }
        }
    }));
  };

  // ... (Rest of logic: handleTurnStart, resolvePvP, etc. remains unchanged) ...
  // [Duplicated logic omitted for brevity as it was correct in previous steps, focusing on providing full working component]
  
  // --- Core Game Logic (Restored) ---
  const handleTurnStart = async () => {
    if (loading) return;
    
    const activeSectId = gameState.turnQueue[gameState.activeSectIndex];
    const activeState = gameState.sectStates[activeSectId];

    if (activeState.skipNextTurn) {
        commitTurn(activeSectId, activeState.locationProgress, activeState.currentLocationName, `【停滞】受前事影响，${SECTS[activeSectId].name} 本回合无法行动。`, true);
        return;
    }

    setLoading(true);
    const inputValue = parseInt(dmInputValue) || 0;
    
    let newProgress = Math.min(GOAL_PROGRESS, activeState.locationProgress + inputValue);
    let locationData = getLocationData(newProgress);
    let narrative = "";

    const aiRes = await GeminiService.generateTurnEvent(
        { ...activeState, locationProgress: newProgress }, 
        locationData, 
        gameState.day, 
        gameState.weather,
        inputValue
    );
    narrative = aiRes.eventText;

    if (newProgress > 0 && newProgress < GOAL_PROGRESS) {
        const collidingSectId = Object.keys(gameState.sectStates).find(key => {
            if (key === activeSectId) return false;
            const s = gameState.sectStates[key as SectId];
            return s.currentLocationName === locationData.name; 
        });

        if (collidingSectId) {
            const description = await GeminiService.generateConflictNarrative(activeSectId, collidingSectId, locationData.name, gameState.weather);
            setInteraction({
                type: 'PVP', activeSectId: activeSectId, targetSectId: collidingSectId as SectId,
                locationName: locationData.name, description: description, pendingProgress: newProgress
            });
            setInteractionValue("5");
            setInteractionStats({ martial: 0, strategy: 0, wealth: 0, prestige: 0 });
            setApplySkipTurn(false); setApplyActionAgain(false);
            setLoading(false);
            return;
        }
    }

    if (Math.random() < 0.70) {
        const eventData = await GeminiService.generateOpportunityEvent(activeState, locationData, gameState.weather);
        setInteraction({
            type: 'OPPORTUNITY', activeSectId: activeSectId, locationName: locationData.name,
            description: eventData.description, pendingProgress: newProgress
        });
        setInteractionValue("5");
        setInteractionStats({ martial: 0, strategy: 0, wealth: 0, prestige: 0 });
        setApplySkipTurn(false); setApplyActionAgain(false);
        setLoading(false);
        return;
    }

    commitTurn(activeSectId, newProgress, locationData.name, narrative);
    setLoading(false);
  };

  const resolvePvP = (winnerId: SectId, type: 'BATTLE' | 'NEGOTIATE' | 'COOP') => {
      if (!interaction) return;
      const { activeSectId, targetSectId, pendingProgress, locationName } = interaction;
      if (!targetSectId) return;

      const loserId = winnerId === activeSectId ? targetSectId : activeSectId;
      const isNegotiation = type === 'NEGOTIATE';
      const isCoop = type === 'COOP';
      const distance = parseInt(interactionValue) || 0;

      let logMsg = "";
      if (isCoop) {
          logMsg = `【联手】在${locationName}，${SECTS[activeSectId].name} 与 ${SECTS[targetSectId].name} 摒弃前嫌，联手御敌！双方皆未退让。`;
      } else if (isNegotiation) {
          logMsg = `【遭遇】在${locationName}，${SECTS[loserId].name} 选择了退让，回撤 ${distance} 里。`;
      } else {
          logMsg = `【交战】在${locationName} 爆发激战！${SECTS[winnerId].name} 胜，${SECTS[loserId].name} 败退 ${distance} 里。`;
      }

      if (!isCoop) {
        setGameState(prev => {
            const loserState = prev.sectStates[loserId];
            const retreatedProgress = Math.max(0, loserState.locationProgress - distance);
            const retreatedLocation = getLocationData(retreatedProgress);
            
            const newVisited = [...loserState.visitedLocations];
            if (retreatedLocation.name !== loserState.currentLocationName && !newVisited.includes(retreatedLocation.name)) {
                newVisited.push(retreatedLocation.name);
            }

            return {
                ...prev,
                sectStates: {
                    ...prev.sectStates,
                    [loserId]: { 
                        ...loserState, 
                        locationProgress: retreatedProgress,
                        currentLocationName: retreatedLocation.name,
                        visitedLocations: newVisited,
                        lastMoveDesc: `-${distance}里 (败)`,
                        history: [...loserState.history, `[第${prev.day}日] ${logMsg}`] 
                    }
                }
            };
        });
      }

      commitTurn(activeSectId, pendingProgress, locationName, logMsg);
      setInteraction(null);
  };

  const resolveOpportunity = (success: boolean, reward: 'FORWARD' | 'BACKWARD') => {
     if (!interaction) return;
     const { activeSectId, pendingProgress, locationName } = interaction;
     const distance = parseInt(interactionValue) || 0;
     const statsDelta = interactionStats;

     let finalProgress = pendingProgress;
     if (success) {
         finalProgress += (reward === 'FORWARD' ? distance : -distance);
     } else {
         finalProgress -= distance;
     }
     finalProgress = Math.max(0, Math.min(GOAL_PROGRESS, finalProgress));
     const finalLocation = getLocationData(finalProgress);

     let extraMsg = [];
     if (applySkipTurn) extraMsg.push("下回合停滞");
     if (applyActionAgain) extraMsg.push("再行一程");

     const logMsg = `【机遇】在${locationName}，${SECTS[activeSectId].name} ${success ? '大吉' : '大凶'}。${success ? '前行' : '后退'} ${distance} 里，至${finalLocation.name}${extraMsg.length ? `，${extraMsg.join('，')}` : ''}。`;

     setGameState(prev => {
        const currentStats = prev.sectStates[activeSectId].stats;
        return {
            ...prev,
            sectStates: {
                ...prev.sectStates,
                [activeSectId]: {
                    ...prev.sectStates[activeSectId],
                    stats: {
                        martial: currentStats.martial + statsDelta.martial,
                        strategy: currentStats.strategy + statsDelta.strategy,
                        wealth: currentStats.wealth + statsDelta.wealth,
                        prestige: currentStats.prestige + statsDelta.prestige,
                    },
                    skipNextTurn: applySkipTurn ? true : prev.sectStates[activeSectId].skipNextTurn
                }
            }
        };
     });

     commitTurn(activeSectId, finalProgress, finalLocation.name, logMsg, false, applyActionAgain);
     setInteraction(null);
  };

  const commitTurn = (sectId: SectId, progress: number, locName: string, logContent: string, wasSkipped = false, actionAgain = false) => {
      setGameState(prev => {
          const prevState = prev.sectStates[sectId];
          const prevProgress = prevState.locationProgress;
          const moveDelta = progress - prevProgress;
          let moveDesc = wasSkipped ? "停滞" : (moveDelta > 0 ? `+${moveDelta}里` : moveDelta < 0 ? `${moveDelta}里` : "原地");
          if (actionAgain) moveDesc += " (连动)";

          const newVisited = [...prevState.visitedLocations];
          if (locName !== prevState.currentLocationName && !newVisited.includes(locName)) {
              newVisited.push(locName);
          }

          const nextSectState = { 
              ...prevState,
              locationProgress: progress,
              currentLocationName: locName,
              visitedLocations: newVisited,
              lastMoveDesc: moveDesc,
              skipNextTurn: wasSkipped ? false : prevState.skipNextTurn,
              history: [...prevState.history, `[第${prev.day}日] ${logContent}`]
          };
          
          const newLog: LogEntry = {
              day: prev.day,
              type: 'move',
              content: logContent
          };

          let nextIndex = prev.activeSectIndex;
          let nextDay = prev.day;
          let nextWeather = prev.weather;
          let dayComplete = false;

          if (!actionAgain) {
              nextIndex = prev.activeSectIndex + 1;
              if (nextIndex >= prev.turnQueue.length) {
                  nextIndex = 0;
                  nextDay += 1;
                  dayComplete = true;
                  nextWeather = getRandomWeather();
              }
          }

          return {
              ...prev,
              day: nextDay,
              weather: nextWeather,
              activeSectIndex: nextIndex,
              isDayComplete: dayComplete,
              sectStates: {
                  ...prev.sectStates,
                  [sectId]: nextSectState
              },
              globalLog: [...prev.globalLog, newLog]
          };
      });
  };

  // --- Renderers ---
  const renderSectBar = () => {
    return (
      <div className="w-full bg-stone-950 border-b border-stone-800 p-4 pb-6 flex items-start justify-center gap-4 shadow-lg z-40 overflow-visible relative">
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-gold/20 to-transparent"></div>
        {SECT_ORDER.map(sectId => {
          const sect = SECTS[sectId];
          const state = gameState.sectStates[sectId];
          const isActive = gameState.turnQueue[gameState.activeSectIndex] === sectId;
          const customImg = gameState.customSectImages?.[sectId];
          const portraitImg = gameState.customSectPortraits?.[sectId];

          return (
            <div 
              key={sectId}
              onClick={() => setViewingSectDetail(sectId)}
              className={`
                group relative flex flex-col items-center cursor-pointer transition-all duration-300 w-24
                ${isActive ? 'opacity-100 -translate-y-2' : 'opacity-70 hover:opacity-100 hover:-translate-y-1'}
              `}
            >
              <div className={`
                w-12 h-12 rounded-lg border-2 overflow-hidden flex items-center justify-center bg-stone-900 shadow-md transition-all mb-2 relative
                ${isActive ? 'border-gold ring-2 ring-gold/30 shadow-[0_0_15px_rgba(197,160,89,0.5)]' : 'border-stone-700'}
              `}>
                 {customImg ? (
                    <img src={customImg} alt={sect.name} className="w-full h-full object-cover" />
                 ) : (
                    <span className={`font-serif font-bold text-sm ${sect.color}`}>{sect.name[0]}</span>
                 )}
                 {state.skipNextTurn && (
                     <div className="absolute inset-0 bg-black/60 flex items-center justify-center text-xs text-red-500 font-bold">停</div>
                 )}
              </div>
              <div className="w-full bg-stone-800 h-1.5 rounded-full overflow-hidden mb-1">
                <div className="bg-gradient-to-r from-yellow-600 to-gold h-full" style={{ width: `${(state.locationProgress / GOAL_PROGRESS) * 100}%` }}></div>
              </div>
              <div className="text-center w-full">
                  <div className="text-[10px] text-stone-300 truncate font-serif leading-tight">{state.currentLocationName}</div>
                  <div className={`text-[10px] font-mono font-bold ${state.lastMoveDesc.includes('+') ? 'text-green-400' : state.lastMoveDesc.includes('-') ? 'text-crimson' : 'text-stone-500'}`}>{state.lastMoveDesc}</div>
              </div>
              
              <div className="absolute bottom-full mb-4 opacity-0 group-hover:opacity-100 transition-all duration-500 ease-out transform translate-y-4 group-hover:translate-y-0 pointer-events-none z-50">
                  <div className="w-64 bg-stone-900 border border-gold/40 rounded-lg shadow-[0_10px_30px_rgba(0,0,0,0.9)] overflow-hidden flex flex-col">
                      <div className="w-full aspect-video bg-stone-950 relative">
                           {portraitImg ? <img src={portraitImg} className="w-full h-full object-cover opacity-90" /> : <div className="w-full h-full flex items-center justify-center text-stone-700 text-xs italic">暂无立绘</div>}
                           <div className="absolute inset-0 bg-gradient-to-t from-stone-900 via-transparent to-transparent"></div>
                           <div className="absolute bottom-0 left-0 w-full p-3">
                                <div className={`font-serif font-bold text-lg leading-none ${sect.color} drop-shadow-md`}>{sect.name}</div>
                                <div className="text-[10px] text-stone-400 mt-1">{sect.title}</div>
                           </div>
                      </div>
                      <div className="p-2 bg-stone-900 border-t border-stone-800 grid grid-cols-4 gap-1 text-[10px] text-stone-400 font-mono text-center">
                          <div className="bg-stone-800/50 rounded px-1">武 {state.stats.martial}</div>
                          <div className="bg-stone-800/50 rounded px-1">智 {state.stats.strategy}</div>
                          <div className="bg-stone-800/50 rounded px-1">财 {state.stats.wealth}</div>
                          <div className="bg-stone-800/50 rounded px-1">望 {state.stats.prestige}</div>
                      </div>
                  </div>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const renderMap = () => {
    const bgStyle = gameState.customMapBg 
      ? { backgroundImage: `url(${gameState.customMapBg})`, backgroundSize: 'cover', backgroundPosition: 'center' } 
      : { backgroundColor: '#1c1917' };

    return (
      <div className="relative w-full h-[400px] shrink-0 border-b border-gold/30 overflow-hidden shadow-2xl bg-stone-900 select-none group perspective-container">
        <div 
             className="absolute w-full h-full preserve-3d transition-transform duration-700 ease-out"
             style={{ 
                 transform: 'rotateX(35deg) scale(0.9) translateY(20px)',
                 transformOrigin: 'center center'
             }}
        >
            <div className="absolute inset-0 shadow-2xl rounded-sm" style={{ ...bgStyle, boxShadow: '0 20px 50px rgba(0,0,0,0.8)' }}>
               {!gameState.customMapBg && <div className="absolute inset-0 flex items-center justify-center text-stone-700 font-serif text-4xl opacity-20">云梦泽 · 逆鳞之路</div>}
               <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/canvas.png')] opacity-30 mix-blend-multiply"></div>
            </div>
            {gameState.customPath && gameState.customPath.length > 1 && (
                <svg className="absolute inset-0 w-full h-full pointer-events-none opacity-50 translate-z-5">
                    <polyline points={gameState.customPath.map(p => `${p.x}%,${p.y}%`).join(' ')} fill="none" stroke="#c5a059" strokeWidth="1.5" strokeDasharray="4,4" style={{ filter: 'drop-shadow(0 2px 2px rgba(0,0,0,0.5))' }} />
                </svg>
            )}
            {SECT_ORDER.map(sectId => {
                const sect = SECTS[sectId];
                const state = gameState.sectStates[sectId];
                const isActive = gameState.turnQueue[gameState.activeSectIndex] === sectId;
                const { left, top } = getPathPosition(state.locationProgress, gameState.customPath);
                const customImg = gameState.customSectImages?.[sectId];
                return (
                    <div key={sectId} className={`absolute flex flex-col items-center transition-all duration-1000 ease-in-out preserve-3d ${isActive ? 'z-30' : 'z-10'}`} style={{ left, top, transform: `translate(-50%, -100%) translateZ(${isActive ? '50px' : '10px'})` }}>
                         <div className={`relative origin-bottom transition-transform duration-300 ${isActive ? 'scale-125' : 'scale-100 opacity-90'}`} style={{ transform: 'rotateX(-35deg)' }}>
                             <div className={`w-10 h-10 rounded border-2 shadow-xl overflow-hidden bg-stone-800 ${isActive ? 'border-gold ring-2 ring-gold/40' : `border-stone-500`}`}>
                                {customImg ? <img src={customImg} className="w-full h-full object-cover" alt={sect.name} /> : <div className={`w-full h-full flex items-center justify-center text-xs font-bold ${sect.color} bg-stone-900`}>{sect.name[0]}</div>}
                             </div>
                             <div className={`absolute -top-5 left-1/2 -translate-x-1/2 bg-black/80 text-[8px] text-gold px-1 rounded whitespace-nowrap border border-gold/20 ${isActive ? 'opacity-100' : 'opacity-0'}`}>{sect.name}</div>
                         </div>
                         <div className="absolute bottom-0 w-8 h-3 bg-black/60 blur-sm rounded-full pointer-events-none" style={{ transform: `translateY(50%) rotateX(0deg) scale(${isActive ? 1.2 : 0.8})`, opacity: isActive ? 0.6 : 0.4 }}></div>
                    </div>
                );
            })}
        </div>
      </div>
    );
  };

  const renderMainArea = () => {
    const activeSectId = gameState.turnQueue[gameState.activeSectIndex];
    const activeSect = SECTS[activeSectId];
    const activeState = gameState.sectStates[activeSectId];
    const activePortrait = gameState.customSectPortraits?.[activeSectId];
    const logsByDay = gameState.globalLog.reduce((acc, log) => {
        if (!acc[log.day]) acc[log.day] = [];
        acc[log.day].push(log);
        return acc;
    }, {} as Record<number, LogEntry[]>);

    return (
        <div className="flex-1 flex flex-col md:flex-row overflow-hidden bg-stone-900 min-h-0">
            <div className="w-full md:w-[320px] shrink-0 p-4 border-r border-stone-800 bg-stone-900 flex flex-col relative z-10 shadow-2xl overflow-y-auto">
                 <div className="mb-6">
                    <div className="flex justify-between items-start mb-2">
                        <div>
                            <h2 className={`text-3xl font-serif font-bold ${activeSect.color} drop-shadow-md`}>{activeSect.name}</h2>
                            <div className="text-xs text-stone-500 font-serif flex items-center gap-1"><span>📍</span> {activeState.currentLocationName} ({activeState.locationProgress}里)</div>
                        </div>
                        <div className="text-right">
                             <div className="text-4xl font-serif text-stone-200 font-bold leading-none">{gameState.day}</div>
                             <div className="text-[10px] text-stone-500 uppercase tracking-widest">Day</div>
                        </div>
                    </div>
                    <div className="w-full aspect-video bg-stone-950 rounded border border-stone-800 overflow-hidden relative shadow-lg mb-2 group">
                        {activePortrait ? <img src={activePortrait} className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105" /> : <div className="w-full h-full flex flex-col items-center justify-center text-stone-700 gap-2"><span className="text-4xl opacity-20">❖</span><span className="text-xs italic">暂无立绘</span></div>}
                        <div className="absolute inset-0 bg-gradient-to-t from-stone-900/80 via-transparent to-transparent pointer-events-none"></div>
                        <div className="absolute bottom-2 right-2 flex items-center gap-1 bg-black/40 px-2 py-0.5 rounded backdrop-blur-sm border border-white/10"><span className="text-lg">🌤️</span><span className="text-xs text-stone-300 font-serif">{gameState.weather.split(' - ')[0]}</span></div>
                    </div>
                 </div>
                 <div className="mb-4 bg-stone-950/50 p-3 rounded border border-stone-800/60 shadow-inner">
                    <div className="grid grid-cols-2 gap-y-2 gap-x-4 text-xs">
                        <StatInput label="武力" value={activeState.stats.martial} onChange={(v) => handleStatEdit(activeSectId, 'martial', v)} />
                        <StatInput label="智谋" value={activeState.stats.strategy} onChange={(v) => handleStatEdit(activeSectId, 'strategy', v)} />
                        <StatInput label="财力" value={activeState.stats.wealth} onChange={(v) => handleStatEdit(activeSectId, 'wealth', v)} />
                        <StatInput label="威望" value={activeState.stats.prestige} onChange={(v) => handleStatEdit(activeSectId, 'prestige', v)} />
                    </div>
                 </div>
                 <div className="space-y-4 bg-stone-800/20 p-4 rounded-lg border border-stone-700/30">
                    <div>
                         <label className="text-gold text-xs mb-2 block font-bold flex items-center gap-1">⚡ DM 裁决</label>
                         <div className="flex gap-2">
                             <input type="number" value={dmInputValue} onChange={(e) => setDmInputValue(e.target.value)} className="flex-1 bg-stone-950 border border-stone-600 text-gold text-xl font-serif p-2 rounded focus:border-gold focus:outline-none text-center" />
                             <div className="flex flex-col justify-center text-xs text-stone-500">里</div>
                         </div>
                    </div>
                    <Button onClick={handleTurnStart} disabled={loading} className="w-full py-3 text-lg tracking-[0.2em]">{loading ? '演化中...' : '行动'}</Button>
                 </div>
                 <div className="mt-auto pt-4 flex flex-col gap-2">
                     <div className="grid grid-cols-2 gap-2">
                        <Button onClick={handleSaveGame} variant="secondary" className="text-[10px] py-2" icon={<span>💾</span>}>保存</Button>
                        <Button onClick={handleLoadGameClick} variant="secondary" className="text-[10px] py-2" icon={<span>📂</span>}>读取</Button>
                     </div>
                     <Button onClick={handleMapUploadClick} variant="ghost" className="text-[10px] py-1 border border-stone-800">更换背景</Button>
                 </div>
            </div>
            <div className="flex-1 bg-stone-950 relative flex flex-col overflow-hidden bg-[url('https://www.transparenttextures.com/patterns/dark-matter.png')]">
                <div className="h-10 border-b border-stone-800 flex items-center justify-between px-6 bg-stone-900/90 backdrop-blur z-20">
                    <h3 className="text-gold font-serif font-bold tracking-[0.2em] text-sm">江湖志</h3>
                    <div className="text-stone-600 text-xs">今日天气：{gameState.weather}</div>
                </div>
                <div className="flex-1 overflow-y-auto p-6 space-y-8 scrollbar-hide">
                    {Object.keys(logsByDay).sort((a,b) => Number(b) - Number(a)).map((dayStr) => {
                        const day = parseInt(dayStr);
                        const entries = logsByDay[day];
                        return (
                            <div key={day} className="relative pl-4 border-l border-stone-800">
                                <div className="absolute -left-[11px] top-0 w-5 h-5 bg-stone-900 border border-stone-600 rounded-full flex items-center justify-center text-[10px] text-gold font-bold">{day}</div>
                                <div className="space-y-3 pt-1">
                                    {entries.map((entry, idx) => (
                                        <div key={idx} className={`p-3 rounded-r border-l-2 text-sm leading-relaxed ${entry.type === 'move' ? 'border-stone-600 bg-stone-900/40 text-stone-300' : entry.type === 'conflict' ? 'border-crimson bg-crimson/5 text-stone-200' : entry.type === 'event' ? 'border-gold bg-gold/5 text-stone-200' : 'border-stone-500 text-stone-500 italic'}`}>{entry.content}</div>
                                    ))}
                                </div>
                            </div>
                        )
                    })}
                    <div ref={logEndRef} className="h-4" />
                </div>
            </div>
        </div>
    );
  };

  const renderSetup = () => {
      const bgStyle = tempMapBg 
        ? { backgroundImage: `url(${tempMapBg})`, backgroundSize: 'cover', backgroundPosition: 'center' } 
        : { backgroundColor: '#1c1917' };

      return (
          <div className="flex-1 flex flex-col bg-stone-950 p-8 overflow-hidden">
              <div className="flex justify-between items-center mb-6">
                  <h2 className="text-3xl font-serif text-gold font-bold">天机阁 · 布设棋局</h2>
                  <div className="flex gap-4">
                      <Button onClick={() => setPhase(GamePhase.INTRO)} variant="ghost">返回</Button>
                      <Button onClick={initializeGame} className="px-8">开启棋局</Button>
                  </div>
              </div>
              <div className="flex-1 flex gap-8 min-h-0">
                  <div className="flex-1 flex flex-col gap-4">
                      <div className="flex justify-between items-center">
                          <h3 className="text-stone-400 text-sm font-bold uppercase tracking-wider">地图设定 (21:9)</h3>
                          <div className="flex gap-2">
                              <Button onClick={handleMapUploadClick} variant="secondary" className="text-xs py-1">上传地图</Button>
                              <Button onClick={() => { setIsDrawingPath(!isDrawingPath); if(!isDrawingPath) setTempPath([]); }} variant={isDrawingPath ? 'danger' : 'secondary'} className="text-xs py-1">{isDrawingPath ? '结束绘制' : '重绘路径'}</Button>
                          </div>
                      </div>
                      <div className="flex-1 bg-stone-900 rounded border border-stone-800 flex items-center justify-center p-4">
                          <div className={`relative w-full shadow-2xl border border-stone-700 overflow-hidden ${isDrawingPath ? 'cursor-crosshair ring-2 ring-gold/50' : ''}`} style={{ aspectRatio: '21 / 9' }} onClick={handleSetupMapClick}>
                               <div className="absolute inset-0" style={bgStyle}>
                                   {!tempMapBg && <div className="absolute inset-0 flex items-center justify-center text-stone-700 text-sm">请上传 21:9 比例地图</div>}
                               </div>
                               {tempPath.length > 0 && (
                                   <svg className="absolute inset-0 w-full h-full pointer-events-none">
                                       <polyline points={tempPath.map(p => `${p.x}%,${p.y}%`).join(' ')} fill="none" stroke="#c5a059" strokeWidth="2" strokeDasharray="5,5" />
                                       {tempPath.map((p, i) => <circle key={i} cx={`${p.x}%`} cy={`${p.y}%`} r="3" fill="#c5a059" />)}
                                   </svg>
                               )}
                               {isDrawingPath && <div className="absolute top-4 left-4 bg-black/70 text-white px-3 py-1 rounded text-xs pointer-events-none">点击地图添加路径点 ({tempPath.length})</div>}
                          </div>
                      </div>
                  </div>
                  <div className="w-1/3 flex flex-col gap-4 overflow-hidden">
                      <h3 className="text-stone-400 text-sm font-bold uppercase tracking-wider">门派设定</h3>
                      <div className="flex-1 overflow-y-auto pr-2 space-y-3 custom-scrollbar">
                          {SECT_ORDER.map(sectId => {
                              const sect = SECTS[sectId];
                              const tokenImg = tempSectImages[sectId];
                              const portraitImg = tempSectPortraits[sectId];
                              return (
                                  <div key={sectId} className="bg-stone-900 p-3 rounded border border-stone-800 flex gap-3 items-center">
                                      <div onClick={() => handleSectImageClick(sectId, 'TOKEN')} className="w-12 h-12 rounded border border-stone-700 bg-stone-800 flex items-center justify-center overflow-hidden cursor-pointer hover:border-gold relative group">
                                          {tokenImg ? <img src={tokenImg} className="w-full h-full object-cover" /> : <span className="text-xs text-stone-500">棋子</span>}
                                          <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center text-[8px] text-white">上传</div>
                                      </div>
                                      <div className="flex-1 min-w-0">
                                          <div className={`font-bold text-sm ${sect.color}`}>{sect.name}</div>
                                          <div className="text-[10px] text-stone-500 truncate">{sect.title}</div>
                                      </div>
                                      <div onClick={() => handleSectImageClick(sectId, 'PORTRAIT')} className="w-20 aspect-video rounded border border-stone-700 bg-stone-800 flex items-center justify-center overflow-hidden cursor-pointer hover:border-gold relative group">
                                          {portraitImg ? <img src={portraitImg} className="w-full h-full object-cover" /> : <span className="text-[10px] text-stone-500">立绘 (16:9)</span>}
                                          <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center text-[8px] text-white">上传</div>
                                      </div>
                                  </div>
                              );
                          })}
                      </div>
                  </div>
              </div>
          </div>
      );
  };

  const renderInteractionModal = () => {
      if (!interaction) return null;
      const activeSect = SECTS[interaction.activeSectId];
      const descParts = interaction.description.split('|||');
      const narrative = descParts[0];
      const dmNotes = descParts[1] || "";

      return (
          <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
              <div className="w-full max-w-2xl bg-stone-900 border border-gold shadow-2xl rounded-lg overflow-hidden animate-fade-in-up flex flex-col max-h-[90vh]">
                  <div className="bg-stone-950 p-4 border-b border-stone-800 flex justify-between items-center shrink-0">
                      <h2 className="text-xl text-gold font-serif font-bold tracking-widest">{interaction.type === 'PVP' ? '⚔️ 狭路相逢' : '✨ 江湖奇遇'}</h2>
                      <div className="text-stone-500 text-xs font-serif">{interaction.locationName}</div>
                  </div>
                  <div className="p-6 overflow-y-auto custom-scrollbar flex-1">
                      <div className="text-stone-200 text-base leading-relaxed py-6 px-8 border-y-2 border-stone-800 bg-stone-950/50 mb-6 font-serif tracking-wide whitespace-pre-wrap">{narrative}</div>
                      {dmNotes && interaction.type === 'OPPORTUNITY' && (
                          <div className="mb-6 bg-stone-950 p-4 rounded border border-stone-800">
                              <h4 className="text-gold font-bold text-xs mb-2 flex items-center gap-2">🔒 DM 判词建议</h4>
                              <div className="text-xs text-stone-400 font-mono whitespace-pre-wrap leading-relaxed pl-2 border-l-2 border-gold/30">{dmNotes}</div>
                          </div>
                      )}
                      <div className="bg-stone-800/30 p-4 rounded border border-gold/30">
                          <h4 className="text-gold font-bold text-sm mb-4 border-b border-stone-700 pb-2 text-center">DM 终局裁决</h4>
                          <div className="flex items-center justify-center gap-4 mb-6">
                              <div className="flex flex-col items-center">
                                <label className="text-stone-400 text-xs mb-1">里程奖惩</label>
                                <div className="flex items-center">
                                    <input type="number" value={interactionValue} onChange={(e) => setInteractionValue(e.target.value)} className="w-20 bg-stone-950 border border-gold text-gold text-xl p-2 rounded text-center focus:outline-none font-bold" />
                                    <span className="text-stone-500 text-sm ml-2">里</span>
                                </div>
                              </div>
                              {interaction.type === 'OPPORTUNITY' && (
                                <div className="flex gap-2">
                                    <button onClick={() => setApplySkipTurn(!applySkipTurn)} className={`px-2 py-2 text-xs rounded border transition-colors ${applySkipTurn ? 'bg-crimson text-white border-crimson' : 'border-stone-600 text-stone-400'}`}>🛑 下回停滞</button>
                                    <button onClick={() => setApplyActionAgain(!applyActionAgain)} className={`px-2 py-2 text-xs rounded border transition-colors ${applyActionAgain ? 'bg-jade text-white border-jade' : 'border-stone-600 text-stone-400'}`}>⏩ 再行一程</button>
                                </div>
                              )}
                          </div>
                          {interaction.type === 'OPPORTUNITY' && (
                            <div className="grid grid-cols-4 gap-4 text-xs text-stone-400">
                                <div className="space-y-1"><div className="text-center font-bold">武力变化</div><input type="number" className="w-full bg-stone-950 border border-stone-600 rounded p-2 text-center text-stone-200" value={interactionStats.martial} onChange={(e) => setInteractionStats({...interactionStats, martial: parseInt(e.target.value) || 0})} /></div>
                                <div className="space-y-1"><div className="text-center font-bold">智谋变化</div><input type="number" className="w-full bg-stone-950 border border-stone-600 rounded p-2 text-center text-stone-200" value={interactionStats.strategy} onChange={(e) => setInteractionStats({...interactionStats, strategy: parseInt(e.target.value) || 0})} /></div>
                                <div className="space-y-1"><div className="text-center font-bold">财力变化</div><input type="number" className="w-full bg-stone-950 border border-stone-600 rounded p-2 text-center text-stone-200" value={interactionStats.wealth} onChange={(e) => setInteractionStats({...interactionStats, wealth: parseInt(e.target.value) || 0})} /></div>
                                <div className="space-y-1"><div className="text-center font-bold">威望变化</div><input type="number" className="w-full bg-stone-950 border border-stone-600 rounded p-2 text-center text-stone-200" value={interactionStats.prestige} onChange={(e) => setInteractionStats({...interactionStats, prestige: parseInt(e.target.value) || 0})} /></div>
                            </div>
                          )}
                      </div>
                      <div className="mt-6 flex gap-4">
                        {interaction.type === 'PVP' && interaction.targetSectId ? (
                            <>
                                <Button onClick={() => resolvePvP(interaction.activeSectId, 'BATTLE')} variant="danger" className="flex-1 text-xs py-3">{activeSect.name} 胜 (对方退)</Button>
                                <Button onClick={() => resolvePvP(interaction.activeSectId, 'NEGOTIATE')} variant="secondary" className="flex-1 text-xs py-3">{activeSect.name} 避 (自愿退)</Button>
                                <div className="w-px bg-stone-700 mx-2"></div>
                                <Button onClick={() => resolvePvP(interaction.targetSectId!, 'BATTLE')} variant="danger" className="flex-1 text-xs py-3">{SECTS[interaction.targetSectId!].name} 胜</Button>
                                <Button onClick={() => resolvePvP(interaction.targetSectId!, 'NEGOTIATE')} variant="secondary" className="flex-1 text-xs py-3">{SECTS[interaction.targetSectId!].name} 避</Button>
                                <Button onClick={() => resolvePvP(interaction.activeSectId, 'COOP')} className="flex-1 text-xs py-3 bg-jade border-jade text-white hover:bg-green-700">🤝 联手共进</Button>
                            </>
                        ) : (
                            <>
                                <Button onClick={() => resolveOpportunity(true, 'FORWARD')} className="flex-1 text-stone-900 bg-gold hover:bg-yellow-400 font-bold py-3 text-lg">大吉 (结算)</Button>
                                <Button onClick={() => resolveOpportunity(false, 'BACKWARD')} variant="ghost" className="flex-1 border border-stone-600 hover:bg-stone-800 text-stone-400 py-3">大凶 (结算)</Button>
                            </>
                        )}
                      </div>
                  </div>
              </div>
          </div>
      );
  };
  
  const renderApiKeyModal = () => {
    if (!showApiKeyModal) return null;
    return (
       <div className="fixed inset-0 z-[100] bg-stone-950/95 backdrop-blur-sm flex items-center justify-center p-4">
           <div className="bg-stone-900 border border-gold/30 p-8 max-w-md text-center shadow-2xl space-y-6 rounded-lg">
               <div className="text-gold text-4xl mb-2">⚠️</div>
               <h2 className="text-xl font-serif font-bold text-stone-200">未检测到 API Key</h2>
               <Button onClick={() => setShowApiKeyModal(false)} variant="secondary" className="w-full">进入江湖</Button>
           </div>
       </div>
    );
  };

  const renderSectDetailModal = () => {
      if (!viewingSectDetail) return null;
      const sect = SECTS[viewingSectDetail];
      const state = gameState.sectStates[viewingSectDetail];
      const portraitImg = gameState.customSectPortraits?.[viewingSectDetail];

      return (
          <div className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex justify-end">
               <div className="w-full max-w-md h-full bg-stone-900 border-l border-gold shadow-2xl flex flex-col animate-slide-in-right relative">
                   <button onClick={() => setViewingSectDetail(null)} className="absolute top-4 right-4 z-20 text-stone-300 hover:text-white text-2xl drop-shadow-md">&times;</button>
                   <div className="w-full aspect-video relative bg-stone-950 shrink-0">
                       {portraitImg ? <img src={portraitImg} className="w-full h-full object-cover mask-gradient-b" /> : <div className="w-full h-full flex items-center justify-center bg-stone-800 text-stone-600 italic">暂无立绘</div>}
                       <div className="absolute inset-0 bg-gradient-to-t from-stone-900 via-transparent to-transparent"></div>
                       <div className="absolute bottom-0 left-0 w-full p-6">
                           <h2 className={`text-4xl font-serif font-bold ${sect.color} mb-1 drop-shadow-md`}>{sect.name}</h2>
                           <p className="text-stone-400 font-serif">{sect.title}</p>
                       </div>
                   </div>
                   <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-stone-900 custom-scrollbar">
                       <div className="grid grid-cols-4 gap-2 text-center p-4 bg-stone-950 rounded border border-stone-800">
                           <div><div className="text-stone-500 text-xs mb-1">武力</div><div className="text-xl text-gold font-serif">{state.stats.martial}</div></div>
                           <div><div className="text-stone-500 text-xs mb-1">智谋</div><div className="text-xl text-gold font-serif">{state.stats.strategy}</div></div>
                           <div><div className="text-stone-500 text-xs mb-1">财富</div><div className="text-xl text-gold font-serif">{state.stats.wealth}</div></div>
                           <div><div className="text-stone-500 text-xs mb-1">威望</div><div className="text-xl text-gold font-serif">{state.stats.prestige}</div></div>
                       </div>
                       <div className="space-y-2">
                           <h3 className="text-stone-500 text-xs font-bold border-b border-stone-800 pb-1">行军路径</h3>
                           <div className="flex flex-wrap gap-2">
                               {state.visitedLocations.map((loc, i) => (
                                   <div key={i} className="flex items-center text-xs text-stone-400 bg-stone-950 px-2 py-1 rounded border border-stone-800">{i > 0 && <span className="mr-1 text-stone-600">→</span>}{loc}</div>
                               ))}
                           </div>
                       </div>
                       <div className="space-y-4">
                            <h3 className="text-stone-500 text-xs font-bold border-b border-stone-800 pb-1">门派过往</h3>
                            {state.history.length === 0 ? <div className="text-stone-600 text-sm">暂无记录</div> : state.history.map((entry, i) => (
                                <div key={i} className="text-stone-300 text-sm border-l border-stone-700 pl-4 py-1 relative"><div className="absolute -left-[5px] top-2 w-2 h-2 rounded-full bg-stone-500"></div>{entry}</div>
                            ))}
                       </div>
                   </div>
               </div>
          </div>
      );
  };

  return (
    <div className="flex flex-col h-screen w-full bg-stone-950 font-sans text-stone-200 overflow-hidden">
        {renderApiKeyModal()}
        <div style={{ display: 'none' }}>
             <input type="file" ref={fileInputRef} accept=".json" onChange={handleFileChange} />
             <input type="file" ref={mapInputRef} accept="image/*" onChange={handleMapFileChange} />
             <input type="file" ref={sectImageInputRef} accept="image/*" onChange={handleSectImageChange} />
        </div>
        {phase === GamePhase.MAIN_LOOP ? (
            <>
                {renderMap()}
                {renderSectBar()}
                {renderMainArea()}
                {renderInteractionModal()}
                {renderSectDetailModal()}
            </>
        ) : phase === GamePhase.SETUP ? renderSetup() : (
             <div className="relative flex-1 flex flex-col items-center justify-center space-y-12">
                <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/rice-paper-3.png')] opacity-5"></div>
                <div className="z-10 text-center space-y-4">
                    <h1 className="text-7xl font-serif text-transparent bg-clip-text bg-gradient-to-b from-[#c5a059] to-[#8a6a28] tracking-[0.2em] drop-shadow-2xl">七曜 · 逆鳞</h1>
                    <p className="text-stone-500 font-serif tracking-widest text-lg">THE SEVEN LUMINARIES</p>
                </div>
                <div className="z-10 flex gap-6">
                    <Button onClick={startSetup} className="text-xl px-12 py-4 border-gold bg-gold/10 hover:bg-gold hover:text-stone-900">开启江湖</Button>
                </div>
            </div>
        )}
    </div>
  );
};

export default App;