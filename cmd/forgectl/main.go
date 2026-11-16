package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"text/tabwriter"

	"github.com/JLCode-tech/bnk-forge/pkg/forgectl"
)

func printUsage() {
	fmt.Println(`forgectl — BNK Forge Air-Gap Bundle Packaging & Mirroring Utility

Usage:
  forgectl <command> [subcommand] [flags]

Commands:
  images list                       Print the required container image Bill of Materials (BOM)
  bundle export [flags]             Package air-gap tarball bundle with SHA256 manifest
  bundle verify [flags]             Validate air-gap bundle integrity and checksums
  bundle mirror [flags]             Generate or execute image mirroring commands
  license inspect [flags]           Offline inspect and verify Ed25519 forge.lic file
  version                           Print forgectl version

Run 'forgectl <command> --help' for details on a specific command.`)
}

func main() {
	if len(os.Args) < 2 {
		printUsage()
		os.Exit(1)
	}

	cmd := os.Args[1]

	switch cmd {
	case "version", "--version", "-v":
		fmt.Printf("forgectl version %s\n", forgectl.Version)

	case "images":
		handleImages(os.Args[2:])

	case "bundle":
		handleBundle(os.Args[2:])

	case "license":
		handleLicense(os.Args[2:])

	case "help", "--help", "-h":
		printUsage()

	default:
		fmt.Fprintf(os.Stderr, "Unknown command: %s\n\n", cmd)
		printUsage()
		os.Exit(1)
	}
}

func handleImages(args []string) {
	if len(args) == 0 || args[0] != "list" {
		fmt.Println("Usage: forgectl images list [--json]")
		os.Exit(1)
	}

	fs := flag.NewFlagSet("images list", flag.ExitOnError)
	asJSON := fs.Bool("json", false, "Output BOM as JSON")
	_ = fs.Parse(args[1:])

	images := forgectl.DefaultImages()

	if *asJSON {
		data, _ := json.MarshalIndent(images, "", "  ")
		fmt.Println(string(data))
		return
	}

	w := tabwriter.NewWriter(os.Stdout, 0, 0, 3, ' ', 0)
	fmt.Fprintln(w, "COMPONENT\tREPOSITORY\tTAG\tIMAGE")
	fmt.Fprintln(w, "---------\t----------\t---\t-----")
	for _, img := range images {
		fmt.Fprintf(w, "%s\t%s\t%s\t%s\n", img.Component, img.Repository, img.Tag, img.FullName())
	}
	_ = w.Flush()
}

func handleBundle(args []string) {
	if len(args) == 0 {
		fmt.Println("Usage: forgectl bundle [export|verify|mirror] [flags]")
		os.Exit(1)
	}

	sub := args[0]
	switch sub {
	case "export":
		fs := flag.NewFlagSet("bundle export", flag.ExitOnError)
		output := fs.String("output", fmt.Sprintf("bnk-forge-airgap-%s.tar.gz", forgectl.Version), "Output tarball path")
		chartsDir := fs.String("charts-dir", "deployments/charts", "Path to Helm charts directory")
		includeCharts := fs.Bool("include-charts", true, "Include Helm charts in bundle archive")
		_ = fs.Parse(args[1:])

		fmt.Printf("[forgectl] Generating air-gap bundle: %s ...\n", *output)
		manifest, err := forgectl.ExportBundle(forgectl.ExportOptions{
			OutputPath:    *output,
			ChartsDir:     *chartsDir,
			IncludeCharts: *includeCharts,
		})
		if err != nil {
			fmt.Fprintf(os.Stderr, "Error exporting bundle: %v\n", err)
			os.Exit(1)
		}

		fmt.Printf("[forgectl] Successfully exported %s\n", *output)
		fmt.Printf("           Images declared:  %d\n", len(manifest.Images))
		fmt.Printf("           Bundled files:    %d\n", len(manifest.Checksums))

	case "verify":
		fs := flag.NewFlagSet("bundle verify", flag.ExitOnError)
		bundle := fs.String("bundle", "", "Path to bundle tarball (.tar.gz)")
		_ = fs.Parse(args[1:])

		if *bundle == "" {
			fmt.Println("Error: --bundle is required")
			fs.Usage()
			os.Exit(1)
		}

		fmt.Printf("[forgectl] Verifying air-gap bundle integrity: %s ...\n", *bundle)
		manifest, err := forgectl.VerifyBundle(*bundle)
		if err != nil {
			fmt.Fprintf(os.Stderr, "Verification FAILED: %v\n", err)
			os.Exit(1)
		}

		fmt.Println("[forgectl] Bundle verification PASSED: integrity and SHA256 checksums verified.")
		fmt.Printf("           Bundle Version: %s\n", manifest.Version)
		fmt.Printf("           Created At:     %s\n", manifest.CreatedAt)
		fmt.Printf("           Total Files:    %d\n", len(manifest.Checksums))
		fmt.Printf("           Total Images:   %d\n", len(manifest.Images))

	case "mirror":
		fs := flag.NewFlagSet("bundle mirror", flag.ExitOnError)
		bundle := fs.String("bundle", "", "Path to bundle tarball (optional)")
		targetRegistry := fs.String("target-registry", "", "Target registry (e.g., harbor.corp.internal/bnk)")
		dryRun := fs.Bool("dry-run", true, "Print commands without executing them")
		_ = fs.Parse(args[1:])

		if *targetRegistry == "" {
			fmt.Println("Error: --target-registry is required")
			fs.Usage()
			os.Exit(1)
		}

		var manifest *forgectl.BundleManifest
		if *bundle != "" {
			v, err := forgectl.VerifyBundle(*bundle)
			if err != nil {
				fmt.Fprintf(os.Stderr, "Error reading bundle: %v\n", err)
				os.Exit(1)
			}
			manifest = v
		} else {
			manifest = &forgectl.BundleManifest{
				Version: forgectl.Version,
				Images:  forgectl.DefaultImages(),
			}
		}

		plans := forgectl.GenerateMirrorPlan(manifest, *targetRegistry)

		if *dryRun {
			fmt.Printf("# =====================================================================\n")
			fmt.Printf("# DRY-RUN: Mirror plan for target registry: %s\n", *targetRegistry)
			fmt.Printf("# =====================================================================\n\n")
			for _, p := range plans {
				fmt.Printf("# [%s]\n", p.Component)
				fmt.Printf("%s\n", p.PullCmd)
				fmt.Printf("%s\n", p.TagCmd)
				fmt.Printf("%s\n\n", p.PushCmd)
			}
			fmt.Println("# To execute this plan, re-run with --dry-run=false")
		} else {
			fmt.Printf("[forgectl] Commencing container image mirroring to %s ...\n", *targetRegistry)
			for _, p := range plans {
				fmt.Printf("--> Mirroring %s: %s -> %s\n", p.Component, p.SourceImage, p.TargetImage)
				for _, cmdStr := range []string{p.PullCmd, p.TagCmd, p.PushCmd} {
					parts := strings.Fields(cmdStr)
					c := exec.Command(parts[0], parts[1:]...)
					c.Stdout = os.Stdout
					c.Stderr = os.Stderr
					if err := c.Run(); err != nil {
						fmt.Fprintf(os.Stderr, "Command failed (%s): %v\n", cmdStr, err)
						os.Exit(1)
					}
				}
			}
			fmt.Println("[forgectl] Mirroring complete.")
		}

	default:
		fmt.Printf("Unknown bundle subcommand: %s\n", sub)
		os.Exit(1)
	}
}

func handleLicense(args []string) {
	if len(args) == 0 {
		fmt.Println("Usage: forgectl license [inspect|verify] [flags]")
		os.Exit(1)
	}

	sub := args[0]
	switch sub {
	case "inspect", "verify":
		fs := flag.NewFlagSet("license inspect", flag.ExitOnError)
		licPath := fs.String("license", "forge.lic", "Path to forge.lic file")
		asJSON := fs.Bool("json", false, "Output verification result as JSON")
		_ = fs.Parse(args[1:])

		res, err := forgectl.InspectLicense(*licPath)
		if err != nil && res == nil {
			fmt.Fprintf(os.Stderr, "Error inspecting license %s: %v\n", *licPath, err)
			os.Exit(1)
		}

		if *asJSON {
			data, _ := json.MarshalIndent(res, "", "  ")
			fmt.Println(string(data))
			return
		}

		fmt.Println("=====================================================================")
		fmt.Println("BNK Forge Offline License Inspection")
		fmt.Println("=====================================================================")
		fmt.Printf("Status:             %s (Usable: %t)\n", res.Status, res.IsUsable)
		fmt.Printf("Customer:           %s\n", res.Customer)
		fmt.Printf("Tier:               %s\n", res.Tier)
		fmt.Printf("License ID:         %s\n", res.LicenseID)
		fmt.Printf("Max Clusters:       %d\n", res.MaxClusters)
		fmt.Printf("Max Nodes:          %d\n", res.MaxNodes)
		fmt.Printf("Days Remaining:     %d\n", res.DaysRemaining)
		if res.GracePeriodActive {
			fmt.Printf("Grace Period:       ACTIVE (%d days remaining)\n", res.GraceDaysRemaining)
		}
		fmt.Printf("Features:           %s\n", strings.Join(res.Features, ", "))
		if res.WarningMessage != "" {
			fmt.Printf("Warning:            %s\n", res.WarningMessage)
		}
		if res.ErrorMessage != "" {
			fmt.Printf("Error:              %s\n", res.ErrorMessage)
		}
		fmt.Println("=====================================================================")

		if !res.IsUsable {
			os.Exit(1)
		}

	default:
		fmt.Printf("Unknown license subcommand: %s\n", sub)
		os.Exit(1)
	}
}
