/** The shape of a *.plugin.toml file — cheap to read, no JS import needed. */
export interface MinimalManifest {
  name: string;
  description: string;
  /** Path to the TS command file, relative to the *.plugin.toml location. */
  command: string;
  enabled: boolean;
  frameworkVersion: string;
  /** Optional path to a markdown file, relative to the *.plugin.toml location. Shown in `docs serve`. */
  docs?: string;
}

/** A plugin found on disk but not yet imported. */
export interface DiscoveredPlugin {
  manifest: MinimalManifest;
  /** Absolute path to the directory containing the *.plugin.toml file. */
  pluginDir: string;
  /** Absolute path to the *.plugin.toml file itself. */
  manifestPath: string;
}
