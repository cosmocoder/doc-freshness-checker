export const captureConsoleLog = () => vi.spyOn(console, 'log').mockImplementation(() => {});

export const captureConsoleWarn = () => vi.spyOn(console, 'warn').mockImplementation(() => {});
