// Inline hook types — not exposed via openclaw/package.json exports yet.
// Mirror from openclaw/src/plugins/types.ts
interface PluginHookBeforePromptBuildEvent {
  prompt: string;
  messages: unknown[];
}
interface PluginHookBeforePromptBuildResult {
  systemPrompt?: string;
  prependContext?: string;
  prependSystemContext?: string;
  appendSystemContext?: string;
}
interface PluginHookAgentContext {
  agentId?: string;
  sessionKey?: string;
  sessionId?: string;
  workspaceDir?: string;
  messageProvider?: string;
  trigger?: string;
  channelId?: string;
}
import type { ToolRetrieverConfig } from "./types.js";
import {searchTools, extractUserQuery, formatSkillsForContext} from "./tool-search.js";
import { logger } from "../utils/logger.js";

const TOOL_RETRIEVER_HEADER = `[系统消息，非用户发言]

`;

const TOOL_RETRIEVER_FOOTER = `
以上是检索到的、与当前用户请求相关的已安装skill，提供了针对特定任务的专门说明。当用户任务与skill描述匹配时，使用read工具加载skill文件。若skill提供为相对路径，在工具命令中使用时将其解析为绝对路径。
`;

const PLUGIN_LOG_PREFIX = "[skill-retriever]";

const SKIP_KEYWORDS = ["安装","装一下", "下载", "查询", "查找", "install", "卸载", "删除", "重载", "定时任务", "重装", "进化"];

const SKIP_PATTERNS = [
  "/new", "/reset", "/compact", "/stop", "/think", "/model", "/fast", "/verbose", "/config", "/debug", "/status", "/tasks", "/whoami", "/context", "/skill", "/commands", "/tools"
];

function shouldSkipSearch(prompt: string): string | null {
  const trimmedPrompt = prompt.trim();

  if (trimmedPrompt.startsWith("/")) {
    return "query starts with / (built-in command)";
  }

  const lowerPrompt = trimmedPrompt.toLowerCase();
  for (const keyword of SKIP_KEYWORDS) {
    if (lowerPrompt.includes(keyword.toLowerCase())) {
      return `query contains keyword: ${keyword}`;
    }
  }

  for (const pattern of SKIP_PATTERNS) {
    if (lowerPrompt.includes(pattern.toLowerCase())) {
      return `query matches pattern: ${pattern}`;
    }
  }

  return null;
}

export function createBeforePromptBuildHandler(config: ToolRetrieverConfig) {
  return async (
    event: PluginHookBeforePromptBuildEvent,
    ctx?: PluginHookAgentContext,
  ): Promise<PluginHookBeforePromptBuildResult | undefined> => {
    const userPrompt = event.prompt;

    if (ctx?.sessionKey?.includes(":subagent:")) {
      return undefined;
    }

    if (!config.enabled) {
      return undefined;
    }

    if (!userPrompt || userPrompt.trim().length === 0) {
      return undefined;
    }

    const extractedQuery = extractUserQuery(userPrompt);

    if (!extractedQuery || extractedQuery.length === 0) {
      return undefined;
    }

    const skipReason = shouldSkipSearch(extractedQuery);
    if (skipReason) {
      return undefined;
    }

    try {
      const searchResult = await searchTools({
        query: extractedQuery,
        maxTools: config.maxTools,
        includeUninstalledOnly: config.includeUninstalledOnly,
        envFilePath: config.envFilePath,
        serviceUrl: config.serviceUrl,
        apiKey: config.apiKey,
        uid: config.uid,
        timeoutMs: config.timeoutMs,
      });

      if (!searchResult || searchResult.disabledSkills.length === 0) {
        return undefined;
      }

      const skillsContext = formatSkillsForContext(searchResult.disabledSkills);
      return {
        prependContext: TOOL_RETRIEVER_HEADER + skillsContext + TOOL_RETRIEVER_FOOTER,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`${PLUGIN_LOG_PREFIX} [ERROR] ${errorMessage}, original query: "${extractedQuery}"`);
      return undefined;
    }
  };
}
