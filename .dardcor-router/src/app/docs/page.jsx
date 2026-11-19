/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Dardcor Corporation. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import Link from 'next/link';

export const metadata = {
  title: 'Documentation | Dardcor Code',
  description: 'Official Documentation and User Guide for Dardcor Code and AI Router.',
};

export default function DocsIndexPage() {
  const sections = [
    {
      category: 'Agent & Autonomous Workflows',
      items: [
        { title: 'Agent Skills System', href: '/docs/agent-customization/agent-skills', desc: 'Built-in skills for autonomous planning, multi-agent swarms, and TDD.' },
        { title: 'MCP Servers Integration', href: '/docs/agent-customization/mcp-servers', desc: 'Connect Model Context Protocol tools and sidecars directly to the editor.' },
        { title: 'Custom Instructions', href: '/docs/agent-customization/custom-instructions', desc: 'Tailor agent responses and project guidelines with system rules.' },
        { title: 'Approval & Sandboxing Modes', href: '/docs/permissions/approval-modes', desc: 'Configure execution security for bash, terminal, and file edits.' },
      ],
    },
    {
      category: 'Editor Architecture & Controls',
      items: [
        { title: 'Workspace Trust', href: '/docs/editor/workspace-trust', desc: 'Managing security and restricted execution in untrusted workspaces.' },
        { title: 'Source Control & Git', href: '/docs/editor/versioncontrol', desc: 'Integrated version control, diff viewing, and branch management.' },
        { title: 'Glob Patterns & Filtering', href: '/docs/configuration/glob-patterns', desc: 'Fast file searching, include/exclude rules, and pattern syntax.' },
        { title: 'Multi-Root Workspaces', href: '/docs/editor/multi-root-workspaces', desc: 'Seamlessly organizing multiple projects and packages in one window.' },
      ],
    },
    {
      category: 'Model Routing & Performance',
      items: [
        { title: 'AI Router Dashboard', href: '/dashboard', desc: 'Real-time telemetry, provider health checks, and cooldown auto-resume.' },
        { title: 'Token Saver & Compression', href: '/dashboard/token-saver', desc: 'Intelligent prompt caching and contextual budget optimization.' },
        { title: 'Remote Extension Architecture', href: '/docs/remote/overview', desc: 'Running extension hosts across WSL, containers, and remote servers.' },
        { title: 'Extension Troubleshooting (Bisect)', href: '/docs/extensions/troubleshooting/bisect', desc: 'Isolate extension bugs and misbehaving plugins quickly.' },
      ],
    },
  ];

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
        </div>
        <div className="flex items-center space-x-4 text-sm">
          <Link href="/dashboard" className="text-[#8b949e] hover:text-white transition">Dashboard</Link>
          <Link href="/docs" className="text-[#58a6ff] font-medium">Docs</Link>
          <a href="https://github.com/Dardcor/Dardcor-Code" target="_blank" rel="noopener noreferrer" className="text-[#8b949e] hover:text-white transition">GitHub</a>
        </div>
      </header>

      <main className="flex-1 max-w-5xl w-full mx-auto px-6 py-12 space-y-12">
        <div className="text-center space-y-3">
          <h1 className="text-4xl font-extrabold text-white tracking-tight">Dardcor Code Documentation</h1>
          <p className="text-[#8b949e] max-w-2xl mx-auto text-base">
            Comprehensive guides, API specifications, and architecture references for developers and agents.
          </p>
        </div>

        <div className="space-y-10">
          {sections.map((sec, idx) => (
            <div key={idx} className="space-y-4">
              <h2 className="text-lg font-semibold text-white tracking-wide border-b border-[#30363d]/70 pb-2 flex items-center space-x-2">
                <span className="w-2 h-2 rounded-full bg-[#6366f1]"></span>
                <span>{sec.category}</span>
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {sec.items.map((item, itemIdx) => (
                  <Link
                    key={itemIdx}
                    href={item.href}
                    className="group bg-[#161b22] border border-[#30363d] hover:border-[#58a6ff]/60 rounded-xl p-5 transition duration-200 block shadow-sm"
                  >
                    <h3 className="font-semibold text-white text-base group-hover:text-[#58a6ff] transition flex items-center justify-between">
                      <span>{item.title}</span>
                      <span className="text-[#8b949e] group-hover:translate-x-1 transition-transform">&rarr;</span>
                    </h3>
                    <p className="text-xs text-[#8b949e] mt-2 leading-relaxed">
                      {item.desc}
                    </p>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      </main>

      <footer className="border-t border-[#30363d] py-6 px-6 text-center text-xs text-[#8b949e] bg-[#161b22]">
        &copy; {new Date().getFullYear()} Dardcor Corporation. All rights reserved.
      </footer>
    </div>
  );
}
