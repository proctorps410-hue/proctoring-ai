let tabSwitchCount = 0;

export const handleTabVisibility = (callback) => {
  const handleVisibilityChange = async () => {
    if (document.hidden) {
      tabSwitchCount++;
      console.log('Tab switch incremented:', tabSwitchCount);
    } else {
      // User returned to tab
      try {
        await callback('tab-switch', tabSwitchCount);
      } catch (error) {
        console.error('Error in tab switch callback:', error);
      }
    }
  };

  document.addEventListener('visibilitychange', handleVisibilityChange);
  return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
};

export const incrementTabSwitchCount = () => {
  tabSwitchCount++;
  return tabSwitchCount;
};

export const getTabSwitchCount = () => tabSwitchCount;
export const resetTabSwitchCount = () => { tabSwitchCount = 0; };
