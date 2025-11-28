export enum SectId {
  TIANHE = 'TIANHE',       // 天河剑宗
  BEIGE = 'BEIGE',         // 悲歌书院
  WANGSHENG = 'WANGSHENG', // 往生门
  FULONG = 'FULONG',       // 伏龙山庄
  NANTUO = 'NANTUO',       // 难陀山
  XUEYI = 'XUEYI',         // 雪衣楼
  DARI = 'DARI'            // 大日琉璃宫
}

export interface SectInfo {
  id: SectId;
  name: string;
  title: string;
  description: string;
  bonus: string;
  weapon: string;
  color: string;
  bgColor: string; // Tailwind bg class for markers
  image: string;
}

export interface LocationData {
  id: number;
  name: string;
  desc: string;
}

export interface SectState {
  id: SectId;
  locationProgress: number; // 0 to 120
  currentLocationName: string; 
  stats: {
    martial: number;   // 武力
    strategy: number;  // 智谋
    wealth: number;    // 财富
    prestige: number;  // 威望
  };
  history: string[]; // Individual log
  
  // New Tracking Fields
  visitedLocations: string[]; // List of unique locations visited
  lastMoveDesc: string; // e.g., "+5里" or "-3里" or "停滞"
  skipNextTurn: boolean; // Mechanics: Forced stay
}

export interface LogEntry {
  day: number;
  content: string;
  type: 'move' | 'conflict' | 'event' | 'system';
}

export interface Point {
  x: number; // percentage 0-100
  y: number; // percentage 0-100
}

export interface GameState {
  day: number;
  weather: string; // Current Day's Weather
  activeSectIndex: number; // 0-6, index in the turn queue
  turnQueue: SectId[];
  isDayComplete: boolean;
  sectStates: Record<SectId, SectState>;
  globalLog: LogEntry[]; // Structured Log
  
  // Customization
  customMapBg?: string;
  customPath?: Point[]; // Array of points for the path
  customSectImages?: Record<string, string>; // Map Tokens (1:1)
  customSectPortraits?: Record<string, string>; // Character Portraits (16:9)
}

// Interaction Types for DM choices
export type InteractionType = 'PVP' | 'OPPORTUNITY';

export interface InteractionState {
  type: InteractionType;
  activeSectId: SectId;
  targetSectId?: SectId; // For PvP
  locationName: string;
  description: string; // AI generated context
  // Pending values to apply after resolution
  pendingProgress: number; 
}

export enum GamePhase {
  INTRO = 'INTRO',
  SETUP = 'SETUP',
  MAIN_LOOP = 'MAIN_LOOP',
  ENDING = 'ENDING'
}