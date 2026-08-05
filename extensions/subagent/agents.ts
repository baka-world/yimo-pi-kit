/**
 * Agent discovery and configuration.
 *
 * Bundled agents provide portable defaults. User agents override bundled agents,
 * and project agents override both when the caller opts into the "both" scope.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { CONFIG_DIR_NAME, getAgentDir, parseFrontmatter } from "@earendil-works/pi-coding-agent";

export type AgentScope = "package" | "user" | "project" | "both";
export type AgentSource = "package" | "user" | "project";
export type AgentThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

const AGENT_THINKING_LEVELS = new Set<AgentThinkingLevel>([
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
]);

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PACKAGE_AGENTS_DIR = path.join(PACKAGE_ROOT, "agents");
const PACKAGE_SKILLS_DIR = path.join(PACKAGE_ROOT, "skills");

export interface AgentConfig {
	name: string;
	description: string;
	tools?: string[];
	skills?: string[];
	missingSkills?: string[];
	model?: string;
	thinking?: AgentThinkingLevel;
	mcpConfig?: string;
	maxWaitSeconds?: number;
	conclusionGraceSeconds?: number;
	maxRetries?: number;
	systemPrompt: string;
	source: AgentSource;
	filePath: string;
}

export interface AgentDiscoveryResult {
	agents: AgentConfig[];
	packageAgentsDir: string;
	userAgentsDir: string;
	projectAgentsDir: string | null;
}

function isDirectory(p: string): boolean {
	try {
		return fs.statSync(p).isDirectory();
	} catch {
		return false;
	}
}

function isFileOrDirectory(p: string): boolean {
	try {
		const stats = fs.statSync(p);
		return stats.isFile() || stats.isDirectory();
	} catch {
		return false;
	}
}

function findNearestProjectResourceDir(cwd: string, relativeParts: string[]): string | null {
	let currentDir = path.resolve(cwd);
	while (true) {
		const candidate = path.join(currentDir, ...relativeParts);
		if (isDirectory(candidate)) return candidate;

		const parentDir = path.dirname(currentDir);
		if (parentDir === currentDir) return null;
		currentDir = parentDir;
	}
}

function findNearestProjectAgentsDir(cwd: string): string | null {
	return findNearestProjectResourceDir(cwd, [CONFIG_DIR_NAME, "agents"]);
}

function buildSkillRoots(cwd: string, source: AgentSource): string[] {
	const roots = [
		PACKAGE_SKILLS_DIR,
		path.join(getAgentDir(), "skills"),
		path.join(os.homedir(), ".agents", "skills"),
	];

	if (source === "project") {
		const piSkills = findNearestProjectResourceDir(cwd, [CONFIG_DIR_NAME, "skills"]);
		const agentSkills = findNearestProjectResourceDir(cwd, [".agents", "skills"]);
		if (piSkills) roots.unshift(piSkills);
		if (agentSkills) roots.unshift(agentSkills);
	}

	return [...new Set(roots.map((root) => path.resolve(root)))];
}

function resolveSkillReference(
	reference: string,
	agentFilePath: string,
	searchRoots: string[],
): { path?: string; name: string } {
	const trimmed = reference.trim();
	const normalized = trimmed.replace(/\\/g, "/");
	const name = normalized.split("/").filter(Boolean).pop() ?? trimmed;

	const direct = path.isAbsolute(trimmed)
		? trimmed
		: path.resolve(path.dirname(agentFilePath), trimmed);
	if (isFileOrDirectory(direct)) return { path: direct, name };

	for (const root of searchRoots) {
		const directoryCandidate = path.join(root, name);
		if (isFileOrDirectory(directoryCandidate)) return { path: directoryCandidate, name };

		const fileCandidate = path.join(root, `${name}.md`);
		if (isFileOrDirectory(fileCandidate)) return { path: fileCandidate, name };
	}

	return { name };
}

function loadAgentsFromDir(dir: string, source: AgentSource, cwd: string): AgentConfig[] {
	const agents: AgentConfig[] = [];
	if (!isDirectory(dir)) return agents;

	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return agents;
	}

	const skillRoots = buildSkillRoots(cwd, source);

	for (const entry of entries) {
		if (!entry.name.endsWith(".md")) continue;
		if (!entry.isFile() && !entry.isSymbolicLink()) continue;

		const filePath = path.join(dir, entry.name);
		let content: string;
		try {
			content = fs.readFileSync(filePath, "utf-8");
		} catch {
			continue;
		}

		const { frontmatter, body } = parseFrontmatter<Record<string, string>>(content);
		if (!frontmatter.name || !frontmatter.description) continue;

		const tools = frontmatter.tools
			?.split(",")
			.map((tool: string) => tool.trim())
			.filter(Boolean);

		const resolvedSkills = frontmatter.skills
			?.split(",")
			.map((skill: string) => skill.trim())
			.filter(Boolean)
			.map((skill: string) => resolveSkillReference(skill, filePath, skillRoots));
		const skills = resolvedSkills?.flatMap((skill) => (skill.path ? [skill.path] : []));
		const missingSkills = resolvedSkills?.flatMap((skill) => (skill.path ? [] : [skill.name]));

		const parseNonNegativeNumber = (value: unknown): number | undefined => {
			if (value === undefined || value === null || String(value).trim() === "") return undefined;
			const parsed = Number(value);
			return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
		};
		const configuredThinking = frontmatter.thinking?.trim() as AgentThinkingLevel | undefined;
		const thinking =
			configuredThinking && AGENT_THINKING_LEVELS.has(configuredThinking)
				? configuredThinking
				: undefined;

		agents.push({
			name: frontmatter.name,
			description: frontmatter.description,
			tools: tools && tools.length > 0 ? tools : undefined,
			skills: skills && skills.length > 0 ? skills : undefined,
			missingSkills: missingSkills && missingSkills.length > 0 ? missingSkills : undefined,
			model: frontmatter.model,
			thinking,
			mcpConfig: frontmatter.mcpConfig
				? path.isAbsolute(frontmatter.mcpConfig)
					? frontmatter.mcpConfig
					: path.resolve(path.dirname(filePath), frontmatter.mcpConfig)
				: undefined,
			maxWaitSeconds: parseNonNegativeNumber(frontmatter.maxWaitSeconds),
			conclusionGraceSeconds: parseNonNegativeNumber(frontmatter.conclusionGraceSeconds),
			maxRetries: parseNonNegativeNumber(frontmatter.maxRetries),
			systemPrompt: body,
			source,
			filePath,
		});
	}

	return agents;
}

export function discoverAgents(cwd: string, scope: AgentScope): AgentDiscoveryResult {
	const userAgentsDir = path.join(getAgentDir(), "agents");
	const projectAgentsDir = findNearestProjectAgentsDir(cwd);

	const packageAgents = scope === "project" ? [] : loadAgentsFromDir(PACKAGE_AGENTS_DIR, "package", cwd);
	const userAgents =
		scope === "user" || scope === "both" ? loadAgentsFromDir(userAgentsDir, "user", cwd) : [];
	const projectAgents =
		scope === "project" || scope === "both"
			? projectAgentsDir
				? loadAgentsFromDir(projectAgentsDir, "project", cwd)
				: []
			: [];

	const agentMap = new Map<string, AgentConfig>();
	for (const agent of packageAgents) agentMap.set(agent.name, agent);
	for (const agent of userAgents) agentMap.set(agent.name, agent);
	for (const agent of projectAgents) agentMap.set(agent.name, agent);

	return {
		agents: Array.from(agentMap.values()),
		packageAgentsDir: PACKAGE_AGENTS_DIR,
		userAgentsDir,
		projectAgentsDir,
	};
}

export function formatAgentList(agents: AgentConfig[], maxItems: number): { text: string; remaining: number } {
	if (agents.length === 0) return { text: "none", remaining: 0 };
	const listed = agents.slice(0, maxItems);
	const remaining = agents.length - listed.length;
	return {
		text: listed.map((agent) => `${agent.name} (${agent.source}): ${agent.description}`).join("; "),
		remaining,
	};
}
