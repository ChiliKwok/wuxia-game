import { GoogleGenAI, GenerateContentResponse } from "@google/genai";
import { SectInfo, SectState, LocationData } from "../types";
import { SECTS } from "../constants";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });
const modelName = 'gemini-2.5-flash';

const BASE_SYSTEM_PROMPT = `
你是一款多人互动文字游戏《七曜：逆鳞之争》的 Dungeon Master (DM)。
游戏目标：七大门派前往“云梦泽”争夺神兵“逆鳞”。
风格要求：古龙/金庸武侠风格，画面感强，精炼，用词考究（如：霎时间、须臾、竟是）。

【重要规则】：
1. 每次描述**必须**包含【时辰】（如：子时、破晓、日跌）。
2. **必须**结合当天的【天气】（如：大雾、暴雨）来描写环境对行动的影响。
3. 氛围描写要与门派特色结合。
4. **绝对不要**生成任何具体的“道具”、“信物”或“后续剧情线索”。所有事件必须当场结算（属性变化或里程变化）。
`;

const WUXIA_SCENARIOS = [
  "落雁坡密信 (午时晴空，拾得火漆密信，世家公子策马而来索要。选择：强索酬金/智探虚实/慨然归还)",
  "破旧山神庙的密谋 (暴雨夜，黑衣人密谋，涉及镇派之宝，隔墙有耳。选择：偷袭/窃听/现身震慑)",
  "悬崖下的遗骸 (迷雾中失足，发现风化骸骨与残缺剑谱。选择：取走剑谱/埋葬遗骸/寻找机关)",
  "缠斗的鹬蚌 (山谷中两高手同归于尽，身旁异光宝物。选择：夺宝/救人/坐收渔利)",
  "无名剑客的赠礼 (落魄剑客赠予古朴剑穗。选择：接受/拒绝/询问缘由)",
  "黑店的醉话 (风雪夜归人，邻桌醉汉提及古墓惊人财富。选择：灌酒套话/无视/暗中跟踪)",
  "湍流中的浮木 (洪峰过后，浮木上缠绕异域尸体。选择：打捞/远观/报官)",
  "古槐下的残局 (村口无人看管的残局，落子引发机关。选择：破局/毁棋/守株待兔)",
  "哭泣的遗孤 (废墟前哭泣的孩童，手中攥着金属碎片。选择：收留/盘问/无视)",
  "赌坊的绝技 (老者神技赢庄家后叹息离去。选择：拜师/护送/挑战)",
  "染血的袈裟 (林中圆寂僧人，托付染血袈裟。选择：送达/私吞/销毁)",
  "月夜箫声 (荒村孤坟，幽咽箫声。选择：合奏/掘墓/驱鬼)",
  "当铺的蒙尘宝刀 (角落里的锈刀与内力共鸣。选择：买下/抢夺/试探老板)",
  "说书人的故事 (酒馆说书人讲前朝秘闻。选择：打赏/以此要挟/暗中保护)",
  "中毒的苍鹰 (坠落的信鹰，脚爪上有警告。选择：截获/救治放飞/伪造回信)",
  "井底的秘密 (干涸古井下锁住的枯骨。选择：开锁/封印/超度)",
  "画舫的琴音 (江上无人画舫，绝美琴音邀君。选择：登船/用内力震断琴弦/水下潜入)",
  "狼群的畏惧 (狼群包围却退散，阴影中走出神秘人。选择：交手/交易/结盟)",
  "豆腐匠的功夫 (卖豆腐老翁单手托千斤磨盘。选择：切磋/偷学/购买豆腐)"
];

// --- Normal Move ---
export const generateTurnEvent = async (
  sectState: SectState, 
  location: LocationData, // Fixed: Pass full location object
  day: number,
  weather: string,
  inputValue: number
): Promise<{ locationName: string; eventText: string; effectSummary: string }> => {
    if (!process.env.API_KEY) {
        return { 
            locationName: location.name, 
            eventText: "迷雾笼罩，无法探知天机。", 
            effectSummary: "无事发生" 
        };
    }

    const sect = SECTS[sectState.id];

    const prompt = `
    当前回合：第 ${day} 天
    天气：【${weather}】
    门派：【${sect.name}】 (${sect.title})
    地点：【${location.name}】
    场景描述：${location.desc}
    动作：全力赶路 (行进 ${inputValue} 里)
    
    任务：
    1. 描述一段简短的行路遭遇（100字内），必须发生在【${location.name}】。
    2. 请结合场景描述：“${location.desc}” 来描写。
    3. 必须体现【${weather}】对赶路的影响。
    
    输出格式（用 "|||" 分隔）：
    (留空) ||| 剧情文本 ||| 简短摘要(4字内)
    `;

    try {
        const response: GenerateContentResponse = await ai.models.generateContent({
          model: modelName,
          contents: prompt,
          config: { systemInstruction: BASE_SYSTEM_PROMPT }
        });
        const parts = (response.text || "").split('|||');
        return {
            locationName: location.name,
            eventText: parts[1]?.trim() || `冒着${weather}继续赶路。`,
            effectSummary: parts[2]?.trim() || "疾行赶路"
        };
    } catch (e) {
        return { locationName: location.name, eventText: "...", effectSummary: "..." };
    }
}

// --- PvP / Co-op Conflict ---
export const generateConflictNarrative = async (
    sectAId: string,
    sectBId: string,
    location: string,
    weather: string
): Promise<string> => {
    if (!process.env.API_KEY) return "狭路相逢，剑拔弩张。";

    const sectA = SECTS[sectAId as any];
    const sectB = SECTS[sectBId as any];

    const prompt = `
    地点：${location}
    天气：${weather}
    双方：【${sectA.name}】 vs 【${sectB.name}】
    
    任务：
    1. 描述两派人马在此狭路相逢的场面（60字左右）。
    2. 必须结合【${weather}】的环境氛围。
    3. 提供一种“共同面对外部危机”的可能性。
    `;

    try {
        const response = await ai.models.generateContent({
            model: modelName,
            contents: prompt,
            config: { systemInstruction: BASE_SYSTEM_PROMPT }
        });
        return response.text?.trim() || "两派对峙。";
    } catch (e) {
        return "两派对峙。";
    }
}

// --- Random Opportunity ---
export const generateOpportunityEvent = async (
    sectState: SectState,
    location: LocationData, // Fixed: Pass full location object
    weather: string
): Promise<{ title: string; description: string }> => {
    if (!process.env.API_KEY) return { title: "江湖奇遇", description: "发现一处神秘洞穴。|||建议：若武力>30可探索。" };

    const sect = SECTS[sectState.id];
    const scenario = WUXIA_SCENARIOS[Math.floor(Math.random() * WUXIA_SCENARIOS.length)];

    const prompt = `
    角色：你是一位资深武侠小说家。
    当前门派：【${sect.name}】
    门派属性：武力${sectState.stats.martial}, 智谋${sectState.stats.strategy}, 财富${sectState.stats.wealth}, 威望${sectState.stats.prestige}
    地点：【${location.name}】
    场景细节：${location.desc}
    天气：${weather}
    灵感素材：${scenario}
    
    任务：创作一个极具代入感的江湖奇遇事件，包含详细的DM判定分支。
    
    输出分为三个部分（用 "|||" 分隔）：
    第一部分：事件标题（4字，古风）
    第二部分：剧情描述（150字左右，结合地点“${location.desc}”和天气）
    第三部分：DM判定方案（详细分支，参考落雁坡密信格式）
    
    **注意：结局只能包含【属性变化】或【里程变化】，无道具。**
    `;

    try {
        const response = await ai.models.generateContent({
            model: modelName,
            contents: prompt,
            config: { systemInstruction: BASE_SYSTEM_PROMPT }
        });
        const parts = (response.text || "").split('|||');
        return {
            title: parts[0]?.trim() || "江湖变故",
            description: (parts[1]?.trim() || `在${weather}中，风云突变。`) + "|||" + (parts[2]?.trim() || "请DM自行裁决。")
        };
    } catch (e) {
        return { title: "未知机遇", description: "景象模糊。|||请DM自行裁决。" };
    }
}
