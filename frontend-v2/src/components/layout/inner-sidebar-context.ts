import React, { createContext, useContext } from "react";

export interface InnerSidebarContextValue {
  collapsed: boolean;
  setCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
}

export const InnerSidebarContext = createContext<InnerSidebarContextValue>({
  collapsed: true,
  setCollapsed: () => {},
});

export function useInnerSidebar() {
  return useContext(InnerSidebarContext);
}
