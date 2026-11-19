/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import Link from 'next/link';

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const title = (slug || []).map(s => s.charAt(0).toUpperCase() + s.slice(1).replace(/-/g, ' ')).join(' - ');
  return {
    title: `${title || 'Documentation'} | Dardcor Code Docs`,
    description: `Official documentation and developer reference for Dardcor Code ${title}.`,
  };
}

export default async function DocsSlugPage({ params }) {
  const { slug } = await params;
  const pathParts = slug || [];
  const currentPath = pathParts.join('/');
  const pageTitle = pathParts.length > 0 
    ? pathParts[pathParts.length - 1].replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
    : 'Overview';
  const categoryTitle = pathParts.length > 1
    ? pathParts[0].replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
    : 'Dardcor Code';

  return (
    <div className="min-h-screen bg-[#0d1117] text-[#c9d1d9] flex flex-col font-sans">
      <header className="border-b border-[#30363d] bg-[#161b22]/90 backdrop-blur sticky top-0 z-50 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <Link href="/docs" className="flex items-center space-x-2 text-white font-semibold text-lg hover:text-[#58a6ff] transition">
            <span className="w-8 h-8 rounded-lg bg-gradient-to-tr from-[#6366f1] to-[#a855f7] flex items-center justify-center font-bold text-white text-sm shadow-md">
              DC
            </span>
            <span>Dardcor Code Docs</span>
          </Link>
          <span className="text-[#8b949e]">/</span>
          <span className="text-[#8b949e] text-sm">{categoryTitle}</span>
        </div>
        <div className="flex items-center space-x-4 text-sm">
          <Link href="/dashboard" className="text-[#8b949e] hover:text-white transition">Dashboard</Link>
          <Link href="/docs" className="text-[#58a6ff] font-medium">Docs</Link>
          <a href="https://github.com/Dardcor/Dardcor-Code" target="_blank" rel="noopener noreferrer" className="text-[#8b949e] hover:text-white transition">GitHub</a>
        </div>
      </header>

      <div className="flex-1 max-w-6xl w-full mx-auto px-6 py-10 grid grid-cols-1 md:grid-cols-4 gap-8">
        <aside className="md:col-span-1 border-r border-[#30363d]/50 pr-6 space-y-6 text-sm">
          <div>
            <h3 className="font-semibold text-white uppercase text-xs tracking-wider mb-3 text-[#8b949e]">Agent & AI</h3>
            <ul className="space-y-2">
              <li><Link href="/docs/agent-customization/mcp-servers" className="hover:text-[#58a6ff] block text-[#c9d1d9]">MCP Servers</Link></li>
              <li><Link href="/docs/agent-customization/agent-skills" className="hover:text-[#58a6ff] block text-[#c9d1d9]">Agent Skills</Link></li>
              <li><Link href="/docs/agent-customization/custom-instructions" className="hover:text-[#58a6ff] block text-[#c9d1d9]">Custom Instructions</Link></li>
              <li><Link href="/docs/agent-customization/custom-agents" className="hover:text-[#58a6ff] block text-[#c9d1d9]">Custom Agents</Link></li>
              <li><Link href="/docs/permissions/approval-modes" className="hover:text-[#58a6ff] block text-[#c9d1d9]">Approval Modes</Link></li>
            </ul>
          </div>
          <div>
            <h3 className="font-semibold text-white uppercase text-xs tracking-wider mb-3 text-[#8b949e]">Editor Core</h3>
            <ul className="space-y-2">
              <li><Link href="/docs/editor/workspace-trust" className="hover:text-[#58a6ff] block text-[#c9d1d9]">Workspace Trust</Link></li>
              <li><Link href="/docs/editor/versioncontrol" className="hover:text-[#58a6ff] block text-[#c9d1d9]">Version Control & Git</Link></li>
              <li><Link href="/docs/configuration/glob-patterns" className="hover:text-[#58a6ff] block text-[#c9d1d9]">Glob Patterns</Link></li>
              <li><Link href="/docs/editor/multi-root-workspaces" className="hover:text-[#58a6ff] block text-[#c9d1d9]">Multi-root Workspaces</Link></li>
              <li><Link href="/docs/terminal/suggestions" className="hover:text-[#58a6ff] block text-[#c9d1d9]">Terminal Suggestions</Link></li>
            </ul>
          </div>
          <div>
            <h3 className="font-semibold text-white uppercase text-xs tracking-wider mb-3 text-[#8b949e]">Extensions & APIs</h3>
            <ul className="space-y-2">
              <li><Link href="/docs/extensions/publishers" className="hover:text-[#58a6ff] block text-[#c9d1d9]">Publishers</Link></li>
              <li><Link href="/docs/extensions/security" className="hover:text-[#58a6ff] block text-[#c9d1d9]">Extension Security</Link></li>
              <li><Link href="/docs/extensions/troubleshooting/bisect" className="hover:text-[#58a6ff] block text-[#c9d1d9]">Extension Bisect</Link></li>
              <li><Link href="/docs/remote/overview" className="hover:text-[#58a6ff] block text-[#c9d1d9]">Remote Architecture</Link></li>
            </ul>
          </div>
        </aside>

        <main className="md:col-span-3 space-y-8">
          <div className="border-b border-[#30363d] pb-6">
            <div className="text-xs uppercase tracking-wider text-[#a855f7] font-semibold mb-2">{categoryTitle}</div>
            <h1 className="text-3xl font-bold text-white">{pageTitle}</h1>
            <p className="text-[#8b949e] mt-2 text-base">
              Reference guide and architecture specifications for <code className="bg-[#161b22] px-1.5 py-0.5 rounded text-[#58a6ff] text-xs font-mono">/{currentPath}</code> in Dardcor Code.
            </p>
          </div>

          <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-6 shadow-sm space-y-4">
            <h2 className="text-lg font-semibold text-white flex items-center space-x-2">
              <span className="w-2 h-2 rounded-full bg-[#10b981]"></span>
              <span>Overview & Feature Context</span>
            </h2>
            <p className="text-sm leading-relaxed text-[#c9d1d9]">
              This topic covers configurations and runtime capabilities in Dardcor Code. Dardcor Code integrates advanced AI model routing, unified token savings, and intelligent autonomous coding workflows directly within the editor shell.
            </p>
            <div className="bg-[#0d1117] border border-[#30363d]/80 rounded-lg p-4 font-mono text-xs text-[#8b949e] overflow-x-auto">
              <div>// Active Documentation Path</div>
              <div className="text-[#58a6ff]">https://www.dardcor-code.web.id/docs/{currentPath}</div>
              <div className="mt-2 text-[#7ee787]">// Status: Active & Operational</div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-5 space-y-2">
              <h3 className="font-medium text-white text-sm">Router Gateway</h3>
              <p className="text-xs text-[#8b949e]">
                Manage model quotas, cooldown auto-resumes, and intelligent provider failovers.
              </p>
              <Link href="/dashboard" className="inline-block text-xs font-medium text-[#58a6ff] hover:underline pt-1">
                Open Dashboard &rarr;
              </Link>
            </div>
            <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-5 space-y-2">
              <h3 className="font-medium text-white text-sm">Skills & Agent Workflows</h3>
              <p className="text-xs text-[#8b949e]">
                Explore built-in super-intelligent skills, tool execution, and multi-agent coordination.
              </p>
              <Link href="/docs/agent-customization/agent-skills" className="inline-block text-xs font-medium text-[#58a6ff] hover:underline pt-1">
                Learn About Skills &rarr;
              </Link>
            </div>
          </div>
        </main>
      </div>

      <footer className="border-t border-[#30363d] py-6 px-6 text-center text-xs text-[#8b949e] bg-[#161b22]">
        &copy; {new Date().getFullYear()} Dardcor Corporation. All rights reserved.
      </footer>
    </div>
  );
}
