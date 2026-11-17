package ebpf

import (
	"net"
	"strings"

	"github.com/JLCode-tech/bnk-forge/pkg/protocol"
)

// DriftConfig defines architectural rules for blueprint verification.
type DriftConfig struct {
	TmmGatewayIPs       []string
	ProtectedNamespaces []string
	ProtectedPorts      []uint16
}

// DriftDetector evaluates live socket flows against declared architecture blueprints.
type DriftDetector struct {
	tmmIPs              map[string]struct{}
	protectedNamespaces map[string]struct{}
	protectedPorts      map[uint16]struct{}
}

// NewDriftDetector initializes rule lookup tables.
func NewDriftDetector(cfg DriftConfig) *DriftDetector {
	tmmIPs := make(map[string]struct{})
	for _, ip := range cfg.TmmGatewayIPs {
		clean := strings.TrimSpace(ip)
		if clean != "" {
			tmmIPs[clean] = struct{}{}
		}
	}

	protNs := make(map[string]struct{})
	for _, ns := range cfg.ProtectedNamespaces {
		clean := strings.TrimSpace(ns)
		if clean != "" {
			protNs[clean] = struct{}{}
		}
	}

	protPorts := make(map[uint16]struct{})
	for _, p := range cfg.ProtectedPorts {
		if p > 0 {
			protPorts[p] = struct{}{}
		}
	}

	return &DriftDetector{
		tmmIPs:              tmmIPs,
		protectedNamespaces: protNs,
		protectedPorts:      protPorts,
	}
}

// CheckBypass determines whether an inbound socket flow violated the TMM gateway path.
func (d *DriftDetector) CheckBypass(flow protocol.EBPFSocketFlow) bool {
	// If no TMM gateway IPs configured, skip bypass detection
	if len(d.tmmIPs) == 0 {
		return false
	}

	// Only evaluate inbound traffic
	if flow.Direction != protocol.FlowDirectionInbound && flow.Direction != protocol.FlowDirectionUnspecified {
		return false
	}

	// Filter out local loopback health checks
	if isLoopback(flow.SrcIP) {
		return false
	}

	// Check if destination is in a protected namespace or port.
	// Note: host-level /proc/net/tcp sockets have an empty Namespace; allow them to be
	// evaluated by ProtectedPorts so host-network bypasses are still caught.
	isTargetNamespace := false
	if len(d.protectedNamespaces) == 0 || flow.Namespace == "" {
		isTargetNamespace = true
	} else if _, ok := d.protectedNamespaces[flow.Namespace]; ok {
		isTargetNamespace = true
	}

	isTargetPort := false
	if len(d.protectedPorts) == 0 {
		isTargetPort = true
	} else if _, ok := d.protectedPorts[flow.DstPort]; ok {
		isTargetPort = true
	}

	if !isTargetNamespace || !isTargetPort {
		return false
	}

	// If source IP matches a known TMM Gateway IP, it properly traversed BNK TMM
	if _, isTMM := d.tmmIPs[flow.SrcIP]; isTMM {
		return false
	}

	// Direct connection bypassing TMM detected!
	return true
}

func isLoopback(ipStr string) bool {
	ip := net.ParseIP(ipStr)
	if ip == nil {
		return ipStr == "127.0.0.1" || ipStr == "::1" || ipStr == "localhost"
	}
	return ip.IsLoopback()
}
