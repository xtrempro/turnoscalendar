export async function performWorkerAppUnlink({
    button,
    confirm,
    unlink,
    onSuccess,
    onError
}) {
    const confirmed = await confirm();

    if (!confirmed) return false;

    button.disabled = true;

    try {
        await unlink();
        onSuccess?.();
        return true;
    } catch (error) {
        button.disabled = false;
        onError?.(error);
        return false;
    }
}
