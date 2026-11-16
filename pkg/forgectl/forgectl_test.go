package forgectl

import (
	"archive/tar"
	"compress/gzip"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/JLCode-tech/bnk-forge/pkg/licensing"
)

const testPrivateKeyB64 = "qvYZ84ClRBZ5QyV/n9hak+UJ2Jof3KFw1ZZJPG0ZO6c="

func TestDefaultImagesBOM(t *testing.T) {
	images := DefaultImages()
	if len(images) != 8 {
		t.Fatalf("expected 8 images in PoV BOM, got %d", len(images))
	}

	foundAgent := false
	foundIngest := false
	for _, img := range images {
		if img.Component == "edge-agent" {
			foundAgent = true
			if img.Repository != "ghcr.io/jlcode-tech/forge-agent" {
				t.Errorf("unexpected repository: %s", img.Repository)
			}
		}
		if img.Component == "ingest-gateway" {
			foundIngest = true
		}
	}

	if !foundAgent || !foundIngest {
		t.Errorf("missing edge-agent or ingest-gateway in default images BOM")
	}
}

func TestExportAndVerifyBundle(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "forgectl-test-*")
	if err != nil {
		t.Fatalf("MkdirTemp failed: %v", err)
	}
	defer os.RemoveAll(tempDir)

	// Create dummy chart files
	chartsDir := filepath.Join(tempDir, "charts")
	err = os.MkdirAll(filepath.Join(chartsDir, "test-chart"), 0755)
	if err != nil {
		t.Fatalf("mkdir failed: %v", err)
	}
	err = os.WriteFile(filepath.Join(chartsDir, "test-chart", "Chart.yaml"), []byte("name: test-chart\nversion: 1.0.0"), 0644)
	if err != nil {
		t.Fatalf("write file failed: %v", err)
	}

	bundlePath := filepath.Join(tempDir, "test-bundle.tar.gz")
	manifest, err := ExportBundle(ExportOptions{
		OutputPath:    bundlePath,
		ChartsDir:     chartsDir,
		IncludeCharts: true,
	})
	if err != nil {
		t.Fatalf("ExportBundle failed: %v", err)
	}

	if manifest.Version != Version {
		t.Errorf("manifest version mismatch: got %s, want %s", manifest.Version, Version)
	}

	// Verify bundle
	verified, err := VerifyBundle(bundlePath)
	if err != nil {
		t.Fatalf("VerifyBundle failed: %v", err)
	}

	if len(verified.Images) != 8 {
		t.Errorf("expected 8 images in verified manifest, got %d", len(verified.Images))
	}
	if len(verified.Checksums) < 2 {
		t.Errorf("expected at least images.txt and chart in checksums, got %d", len(verified.Checksums))
	}
}

func TestVerifyBundleTamperDetection(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "forgectl-tamper-*")
	if err != nil {
		t.Fatalf("MkdirTemp failed: %v", err)
	}
	defer os.RemoveAll(tempDir)

	bundlePath := filepath.Join(tempDir, "tampered-bundle.tar.gz")
	_, err = ExportBundle(ExportOptions{
		OutputPath: bundlePath,
	})
	if err != nil {
		t.Fatalf("ExportBundle failed: %v", err)
	}

	// Create a corrupted bundle by modifying images.txt content while keeping original manifest
	corruptedPath := filepath.Join(tempDir, "corrupted.tar.gz")
	corruptArchive(t, bundlePath, corruptedPath)

	_, err = VerifyBundle(corruptedPath)
	if err == nil {
		t.Fatalf("expected VerifyBundle to fail on tampered content, but it succeeded")
	}
}

func TestMirrorPlan(t *testing.T) {
	manifest := &BundleManifest{
		Version: Version,
		Images:  DefaultImages(),
	}

	plans := GenerateMirrorPlan(manifest, "harbor.internal.corp/bnk")
	if len(plans) != 8 {
		t.Fatalf("expected 8 mirror plans, got %d", len(plans))
	}

	agentPlan := plans[0]
	if agentPlan.SourceImage != "ghcr.io/jlcode-tech/forge-agent:v1.0.0-pov" {
		t.Errorf("unexpected source image: %s", agentPlan.SourceImage)
	}
	if agentPlan.TargetImage != "harbor.internal.corp/bnk/forge-agent:v1.0.0-pov" {
		t.Errorf("unexpected target image: %s", agentPlan.TargetImage)
	}
	if agentPlan.TagCmd != "docker tag ghcr.io/jlcode-tech/forge-agent:v1.0.0-pov harbor.internal.corp/bnk/forge-agent:v1.0.0-pov" {
		t.Errorf("unexpected tag command: %s", agentPlan.TagCmd)
	}
}

func TestInspectLicense(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "forgectl-lic-*")
	if err != nil {
		t.Fatalf("MkdirTemp failed: %v", err)
	}
	defer os.RemoveAll(tempDir)

	// Generate valid test license
	seedBytes, _ := base64.StdEncoding.DecodeString(testPrivateKeyB64)
	privKey := ed25519.NewKeyFromSeed(seedBytes)

	now := time.Now().Unix()
	payload := map[string]interface{}{
		"license_id":        "pov-lic-test",
		"customer":          "Viettel Group",
		"tier":              "enterprise",
		"issued_at":         float64(now - 3600),
		"expires_at":        float64(now + 86400*30),
		"grace_period_days": float64(30),
		"max_clusters":      float64(5),
		"max_nodes":         float64(100),
		"features":          []interface{}{"ebpf_telemetry", "tmm_dpdk", "nats_leaf", "ai_gateway"},
	}

	canonicalBytes, err := licensing.CanonicalizePayload(payload)
	if err != nil {
		t.Fatalf("canonicalize failed: %v", err)
	}
	sig := ed25519.Sign(privKey, canonicalBytes)

	env := licensing.LicenseEnvelope{
		Payload:   payload,
		Signature: base64.StdEncoding.EncodeToString(sig),
	}

	fileBytes, _ := json.Marshal(env)
	licPath := filepath.Join(tempDir, "forge.lic")
	err = os.WriteFile(licPath, fileBytes, 0644)
	if err != nil {
		t.Fatalf("write license failed: %v", err)
	}

	res, err := InspectLicense(licPath)
	if err != nil {
		t.Fatalf("InspectLicense failed: %v", err)
	}

	if res.Status != licensing.StatusValid {
		t.Errorf("expected status %s, got %s", licensing.StatusValid, res.Status)
	}
	if !res.IsUsable {
		t.Errorf("expected license to be usable")
	}
	if res.Customer != "Viettel Group" {
		t.Errorf("customer mismatch: %s", res.Customer)
	}
	if res.MaxClusters != 5 {
		t.Errorf("max clusters mismatch: %d", res.MaxClusters)
	}
	if res.MaxNodes != 100 {
		t.Errorf("max nodes mismatch: %d", res.MaxNodes)
	}
}

func corruptArchive(t *testing.T, srcBundle, dstBundle string) {
	srcFile, err := os.Open(srcBundle)
	if err != nil {
		t.Fatalf("open src failed: %v", err)
	}
	defer srcFile.Close()

	gr, err := gzip.NewReader(srcFile)
	if err != nil {
		t.Fatalf("gzip read failed: %v", err)
	}
	defer gr.Close()

	tr := tar.NewReader(gr)

	dstFile, err := os.Create(dstBundle)
	if err != nil {
		t.Fatalf("create dst failed: %v", err)
	}
	defer dstFile.Close()

	gw := gzip.NewWriter(dstFile)
	defer gw.Close()

	tw := tar.NewWriter(gw)
	defer tw.Close()

	for {
		hdr, err := tr.Next()
		if err != nil {
			break
		}
		data, _ := io.ReadAll(tr)
		if hdr.Name == "images.txt" {
			data = []byte("tampered-image:latest\n")
			hdr.Size = int64(len(data))
		}
		_ = tw.WriteHeader(hdr)
		_, _ = tw.Write(data)
	}
}
