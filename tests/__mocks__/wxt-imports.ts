
export const storage = {
    defineItem: <T>(_key: string, options?: { defaultValue?: T }) => ({
        getValue: async () => options?.defaultValue,
        setValue: async (_value: T) => { },
        watch: (_callback: (value: T | null, oldValue: T | null) => void) => () => { },
    }),
};
