{
  description = "freeagent-mcp server — layered OCI image for delivery into the Hermes pod";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs = { self, nixpkgs, ... }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" ];
      forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f {
        inherit system;
        pkgs = nixpkgs.legacyPackages.${system};
      });

      lastModified = builtins.toString (self.lastModified or 1);

      server = "freeagent";
      version = "1.2.0";
    in
    {
      packages = forAllSystems ({ pkgs, system }:
        let
          # Compile the TypeScript server and bundle the resolved
          # node_modules. buildNpmPackage resolves the dependency tree at
          # build time into a fixed-output derivation pinned by npmDepsHash
          # (offline `npm ci` from the prefetched cache — no network-at-boot
          # for the pod, and no online-install flakiness in CI). The default
          # build phase runs the package's `build` script (tsc → build/). We
          # override installPhase to stage the runnable tree — compiled
          # build/ + package.json + the full node_modules — so the server
          # runs with a bare `node <root>/build/index.js` from any cwd (node
          # resolves imports relative to build/index.js → ../node_modules).
          # The server's only filesystem state is the OAuth token file at
          # $HOME/.freeagent-mcp/tokens.json (HOME-relative, not cwd).
          serverApp = pkgs.buildNpmPackage {
            pname = "freeagent-mcp";
            inherit version;
            src = ./.;
            npmDepsHash = "sha256-wAxpNhncWbeAmmfEd7cvD9NJ6K5yQYzxt/8qd8NVaDE=";
            dontNpmPrune = true;
            installPhase = ''
              runHook preInstall
              mkdir -p "$out"
              cp -R build "$out/build"
              cp package.json "$out/package.json"
              cp -R node_modules "$out/node_modules"
              runHook postInstall
            '';
          };

          # The runnable server staged at the in-image path the Hermes pod
          # extracts from (init-container → shared volume), mirroring
          # hermes-skills' skills layout.
          serverLayout = pkgs.runCommand "freeagent-mcp-layout" { } ''
            mkdir -p "$out/opt/data/.hermes/mcp/${server}"
            cp -R ${serverApp}/. "$out/opt/data/.hermes/mcp/${server}/"
          '';

          mcp-image = pkgs.dockerTools.buildLayeredImage {
            name = "hermes-mcp-${server}";
            tag = "nix-build";
            created = "@${lastModified}";
            contents = [ serverLayout pkgs.coreutils ];
            config = {
              Labels = {
                "com.graemef.hermes-mcp.server" = server;
                "com.graemef.hermes-mcp.version" = version;
              };
            };
          };
        in
        {
          inherit serverApp;
        } // pkgs.lib.optionalAttrs pkgs.stdenv.isLinux {
          inherit mcp-image;
          default = mcp-image;
        });

      devShells = forAllSystems ({ pkgs, system }: {
        default = pkgs.mkShell {
          packages = [ pkgs.nodejs ];
        };
      });
    };
}
