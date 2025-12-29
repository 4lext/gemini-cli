# Browser Control Sub-Agent

This module implements a specialized sub-agent for controlling a web browser
using the `gemini-2.5-computer-use-preview-10-2025` model.

## Capabilities

- **Navigation:** Go to URLs.
- **Interaction:** Click elements, type text, scroll.
- **Visual Context:** Sends screenshots and accessibility tree snapshots to the
  model for visual grounding.

## Architecture

- **`BrowserManager`:** Manages the connection to the Chrome browser via the
  Model Context Protocol (MCP) using the `chrome-devtools-mcp` server. It
  expects a running Chrome instance or attempts to connect to one.
- **`BrowserTools`:** Defines the low-level actions available to the model
  (`navigate`, `click_at`, etc.), translating them into MCP tool calls (e.g.,
  `evaluate_script`, `navigate_page`).
- **`BrowserAgent`:** Implements the agent loop. It overrides the standard
  `GeminiClient` model to use the specialized Computer Use model. It handles the
  turn-taking loop, capturing state (screenshots) after every tool execution and
  feeding it back to the model.

* **`BrowserTool`:** The entry point for the main Gemini CLI agent. It exposes a
  `computer_use_browser` tool that the main agent can call to delegate a task to
  this sub-agent.
* **Location:** `packages/core/src/agents/browser/`

## Security

- **Headed Mode:** The agent interacts with a real Chrome browser instance, so
  the user can observe all actions.
- **Safety Loop:** The agent loop runs for a maximum of 20 turns to prevent
  infinite loops.
- **MCP Security:** Interaction is mediated through the MCP server, which
  provides an abstraction layer over raw DevTools protocol commands.

## Usage

To use this feature, the `BrowserTool` must be registered with the
`GeminiClient`. Once registered, you can prompt the CLI:

> "Go to google.com and search for Gemini CLI"

The main agent will invoke `computer_use_browser`, which triggers the sub-agent
loop.
