let copyPasteCount = 0;

export const incrementCopyPasteCount = () => {
    copyPasteCount++;
    return copyPasteCount;
};

export const getCopyPasteCount = () => copyPasteCount;
export const resetCopyPasteCount = () => { copyPasteCount = 0; };
export const handleCopyPaste = (callback) => {
    const handleEvent = async (e) => {
        e.preventDefault();
        copyPasteCount++;
        console.log('Copy-paste attempt:', copyPasteCount);

        try {
            await callback('copy-paste', copyPasteCount);
        } catch (error) {
            console.error('Error in copy-paste callback:', error);
        }
    };

    document.addEventListener('copy', handleEvent, true);
    document.addEventListener('cut', handleEvent, true);
    document.addEventListener('paste', handleEvent, true);
    document.addEventListener('contextmenu', handleEvent, true); // Block right-click

    return () => {
        document.removeEventListener('copy', handleEvent, true);
        document.removeEventListener('cut', handleEvent, true);
        document.removeEventListener('paste', handleEvent, true);
        document.removeEventListener('contextmenu', handleEvent, true);
    };
};
