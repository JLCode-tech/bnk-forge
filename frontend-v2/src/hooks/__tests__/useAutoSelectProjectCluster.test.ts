import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useState } from "react";
import { useAutoSelectProjectCluster } from "../useAutoSelectProjectCluster";

describe("useAutoSelectProjectCluster", () => {
  it("auto-selects project and cluster on initial load when exactly one of each exists", () => {
    const { result } = renderHook(() => {
      const [selectedProject, setSelectedProject] = useState<number | null>(null);
      const [selectedCluster, setSelectedCluster] = useState<number | null>(null);

      useAutoSelectProjectCluster({
        projects: [{ id: 1 }],
        allClusters: [{ id: 101, project_id: 1 }],
        visibleClusters: [{ id: 101 }],
        selectedProject,
        selectedCluster,
        setSelectedProject,
        setSelectedCluster,
      });

      return { selectedProject, selectedCluster, setSelectedProject, setSelectedCluster };
    });

    expect(result.current.selectedProject).toBe(1);
    expect(result.current.selectedCluster).toBe(101);
  });

  it("does not re-select when user explicitly sets cluster to null (All Clusters)", () => {
    const { result } = renderHook(() => {
      const [selectedProject, setSelectedProject] = useState<number | null>(null);
      const [selectedCluster, setSelectedCluster] = useState<number | null>(null);

      useAutoSelectProjectCluster({
        projects: [{ id: 1 }],
        allClusters: [{ id: 101, project_id: 1 }],
        visibleClusters: [{ id: 101 }],
        selectedProject,
        selectedCluster,
        setSelectedProject,
        setSelectedCluster,
      });

      return { selectedProject, selectedCluster, setSelectedProject, setSelectedCluster };
    });

    expect(result.current.selectedCluster).toBe(101);

    // User chooses "All Clusters"
    act(() => {
      result.current.setSelectedCluster(null);
    });

    // It must remain null (not forcibly snap back to 101)
    expect(result.current.selectedCluster).toBe(null);
  });

  it("does not re-select when user explicitly sets project to null (All Projects)", () => {
    const { result } = renderHook(() => {
      const [selectedProject, setSelectedProject] = useState<number | null>(null);
      const [selectedCluster, setSelectedCluster] = useState<number | null>(null);

      useAutoSelectProjectCluster({
        projects: [{ id: 1 }],
        allClusters: [{ id: 101, project_id: 1 }],
        visibleClusters: [{ id: 101 }],
        selectedProject,
        selectedCluster,
        setSelectedProject,
        setSelectedCluster,
      });

      return { selectedProject, selectedCluster, setSelectedProject, setSelectedCluster };
    });

    expect(result.current.selectedProject).toBe(1);

    // User chooses "All Projects"
    act(() => {
      result.current.setSelectedProject(null);
    });

    // It must remain null
    expect(result.current.selectedProject).toBe(null);
  });

  it("does not auto-select when enabled is false", () => {
    const { result } = renderHook(() => {
      const [selectedProject, setSelectedProject] = useState<number | null>(null);
      const [selectedCluster, setSelectedCluster] = useState<number | null>(null);

      useAutoSelectProjectCluster({
        projects: [{ id: 1 }],
        allClusters: [{ id: 101, project_id: 1 }],
        visibleClusters: [{ id: 101 }],
        selectedProject,
        selectedCluster,
        setSelectedProject,
        setSelectedCluster,
        enabled: false,
      });

      return { selectedProject, selectedCluster };
    });

    expect(result.current.selectedProject).toBe(null);
    expect(result.current.selectedCluster).toBe(null);
  });

  it("does not auto-select when multiple clusters exist", () => {
    const { result } = renderHook(() => {
      const [selectedProject, setSelectedProject] = useState<number | null>(null);
      const [selectedCluster, setSelectedCluster] = useState<number | null>(null);

      useAutoSelectProjectCluster({
        projects: [{ id: 1 }],
        allClusters: [
          { id: 101, project_id: 1 },
          { id: 102, project_id: 1 },
        ],
        visibleClusters: [{ id: 101 }, { id: 102 }],
        selectedProject,
        selectedCluster,
        setSelectedProject,
        setSelectedCluster,
      });

      return { selectedProject, selectedCluster };
    });

    expect(result.current.selectedProject).toBe(null);
    expect(result.current.selectedCluster).toBe(null);
  });
});
