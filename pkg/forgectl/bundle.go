package forgectl

import (
	"archive/tar"
	"compress/gzip"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/JLCode-tech/bnk-forge/pkg/licensing"
)

// Version of forgectl and PoV bundle.
const Version = "1.0.0-pov"

// ImageItem defines a required container image.
type ImageItem struct {
	Component  string `json:"component"`
	Repository string `json:"repository"`
	Tag        string `json:"tag"`
}

// FullName returns the repository:tag string.
func (i ImageItem) FullName() string {
	return fmt.Sprintf("%s:%s", i.Repository, i.Tag)
}

// TargetName returns the image path retagged for a target private registry.
func (i ImageItem) TargetName(targetRegistry string) string {
	targetRegistry = strings.TrimRight(targetRegistry, "/")
	parts := strings.Split(i.Repository, "/")
	name := parts[len(parts)-1]
	return fmt.Sprintf("%s/%s:%s", targetRegistry, name, i.Tag)
}

// DefaultImages returns the canonical container image Bill of Materials (BOM) for PoV.
func DefaultImages() []ImageItem {
	return []ImageItem{
		{
			Component:  "edge-agent",
			Repository: "ghcr.io/jlcode-tech/forge-agent",
			Tag:        "v1.0.0-pov",
		},
		{
			Component:  "ingest-gateway",
			Repository: "ghcr.io/jlcode-tech/forge-ingest",
			Tag:        "v1.0.0-pov",
		},
		{
			Component:  "backend-control-plane",
			Repository: "ghcr.io/jlcode-tech/forge-backend",
			Tag:        "v1.0.0-pov",
		},
		{
			Component:  "frontend-console",
			Repository: "ghcr.io/jlcode-tech/forge-frontend",
			Tag:        "v1.0.0-pov",
		},
		{
			Component:  "task-worker",
			Repository: "ghcr.io/jlcode-tech/forge-worker",
			Tag:        "v1.0.0-pov",
		},
		{
			Component:  "telemetry-db",
			Repository: "clickhouse/clickhouse-server",
			Tag:        "24.3-alpine",
		},
		{
			Component:  "messaging-jetstream",
			Repository: "nats",
			Tag:        "2.10-alpine",
		},
		{
			Component:  "relational-db",
			Repository: "postgres",
			Tag:        "16-alpine",
		},
	}
}

// BundleManifest describes the contents and cryptographic checksums of an air-gap package.
type BundleManifest struct {
	Version   string            `json:"version"`
	CreatedAt string            `json:"created_at"`
	Images    []ImageItem       `json:"images"`
	Checksums map[string]string `json:"checksums"` // relative path -> sha256 hex
}

// ExportOptions specifies configuration for building an air-gap bundle.
type ExportOptions struct {
	OutputPath    string
	ChartsDir     string // path to deployments/charts
	IncludeCharts bool
	Images        []ImageItem
}

// ExportBundle creates a compressed tar.gz air-gap archive with manifest and checksums.
func ExportBundle(opts ExportOptions) (*BundleManifest, error) {
	if opts.OutputPath == "" {
		opts.OutputPath = fmt.Sprintf("bnk-forge-airgap-%s.tar.gz", Version)
	}
	if len(opts.Images) == 0 {
		opts.Images = DefaultImages()
	}

	manifest := &BundleManifest{
		Version:   Version,
		CreatedAt: time.Now().UTC().Format(time.RFC3339),
		Images:    opts.Images,
		Checksums: make(map[string]string),
	}

	// Staging map of file contents to package
	stagedFiles := make(map[string][]byte)

	// 1. Generate images.txt
	var sb strings.Builder
	for _, img := range opts.Images {
		sb.WriteString(img.FullName() + "\n")
	}
	imagesTxtBytes := []byte(sb.String())
	stagedFiles["images.txt"] = imagesTxtBytes
	manifest.Checksums["images.txt"] = hashBytes(imagesTxtBytes)

	// 2. Add Helm charts if requested
	if opts.IncludeCharts && opts.ChartsDir != "" {
		err := filepath.Walk(opts.ChartsDir, func(path string, info os.FileInfo, err error) error {
			if err != nil {
				return err
			}
			if info.IsDir() {
				return nil
			}
			relPath, err := filepath.Rel(opts.ChartsDir, path)
			if err != nil {
				return err
			}
			// normalize to forward slash
			relKey := filepath.ToSlash(filepath.Join("charts", relPath))
			data, err := os.ReadFile(path)
			if err != nil {
				return err
			}
			stagedFiles[relKey] = data
			manifest.Checksums[relKey] = hashBytes(data)
			return nil
		})
		if err != nil {
			return nil, fmt.Errorf("packaging charts error: %w", err)
		}
	}

	// 3. Serialize manifest.json
	manifestBytes, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return nil, fmt.Errorf("serializing manifest error: %w", err)
	}
	stagedFiles["manifest.json"] = manifestBytes

	// 4. Write tar.gz archive
	outFile, err := os.Create(opts.OutputPath)
	if err != nil {
		return nil, fmt.Errorf("creating archive %s: %w", opts.OutputPath, err)
	}
	defer outFile.Close()

	gw := gzip.NewWriter(outFile)
	defer gw.Close()

	tw := tar.NewWriter(gw)
	defer tw.Close()

	for relPath, data := range stagedFiles {
		hdr := &tar.Header{
			Name:    relPath,
			Mode:    0644,
			Size:    int64(len(data)),
			ModTime: time.Now(),
		}
		if err := tw.WriteHeader(hdr); err != nil {
			return nil, fmt.Errorf("writing tar header for %s: %w", relPath, err)
		}
		if _, err := tw.Write(data); err != nil {
			return nil, fmt.Errorf("writing tar body for %s: %w", relPath, err)
		}
	}

	return manifest, nil
}

// VerifyBundle reads an air-gap tarball, verifies SHA256 checksums, and parses the manifest.
func VerifyBundle(bundlePath string) (*BundleManifest, error) {
	file, err := os.Open(bundlePath)
	if err != nil {
		return nil, fmt.Errorf("opening bundle: %w", err)
	}
	defer file.Close()

	gr, err := gzip.NewReader(file)
	if err != nil {
		return nil, fmt.Errorf("initializing gzip reader: %w", err)
	}
	defer gr.Close()

	tr := tar.NewReader(gr)

	archiveFiles := make(map[string][]byte)
	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("tar read error: %w", err)
		}
		if hdr.FileInfo().IsDir() {
			continue
		}

		data, err := io.ReadAll(tr)
		if err != nil {
			return nil, fmt.Errorf("reading archive entry %s: %w", hdr.Name, err)
		}
		archiveFiles[filepath.ToSlash(hdr.Name)] = data
	}

	manifestData, ok := archiveFiles["manifest.json"]
	if !ok {
		return nil, fmt.Errorf("bundle missing required manifest.json")
	}

	var manifest BundleManifest
	if err := json.Unmarshal(manifestData, &manifest); err != nil {
		return nil, fmt.Errorf("parsing manifest.json: %w", err)
	}

	// Verify all checksums
	for relPath, expectedHash := range manifest.Checksums {
		data, exists := archiveFiles[relPath]
		if !exists {
			return nil, fmt.Errorf("corrupted bundle: missing file %s declared in manifest", relPath)
		}
		actualHash := hashBytes(data)
		if actualHash != expectedHash {
			return nil, fmt.Errorf("checksum mismatch for %s: expected %s, got %s", relPath, expectedHash, actualHash)
		}
	}

	return &manifest, nil
}

// MirrorPlan represents an individual image mirroring step.
type MirrorPlan struct {
	Component   string `json:"component"`
	SourceImage string `json:"source_image"`
	TargetImage string `json:"target_image"`
	PullCmd     string `json:"pull_cmd"`
	TagCmd      string `json:"tag_cmd"`
	PushCmd     string `json:"push_cmd"`
}

// GenerateMirrorPlan generates Docker CLI mirror commands for a given registry.
func GenerateMirrorPlan(manifest *BundleManifest, targetRegistry string) []MirrorPlan {
	var plans []MirrorPlan
	for _, img := range manifest.Images {
		src := img.FullName()
		tgt := img.TargetName(targetRegistry)
		plans = append(plans, MirrorPlan{
			Component:   img.Component,
			SourceImage: src,
			TargetImage: tgt,
			PullCmd:     fmt.Sprintf("docker pull %s", src),
			TagCmd:      fmt.Sprintf("docker tag %s %s", src, tgt),
			PushCmd:     fmt.Sprintf("docker push %s", tgt),
		})
	}
	return plans
}

// InspectLicense inspects an Ed25519 license file offline using pkg/licensing.
func InspectLicense(licensePath string) (*licensing.VerificationResult, error) {
	return licensing.VerifyLicenseFile(licensePath, licensing.DefaultEmbeddedPublicKeyB64)
}

func hashBytes(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}
