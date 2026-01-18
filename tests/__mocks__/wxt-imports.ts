
export const storage = {
    defineItem: (key, options) => ({
        getValue: async () => options?.defaultValue,
        setValue: async () => { },
        watch: () => () => { },
    }),
};
