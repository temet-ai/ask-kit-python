def relay(message: str, hops: int = 3) -> str:
    """Pass a message along `hops` towers."""
    return f"{message} (after {hops} towers)"


def overhead(message):
    return len(message) * 2
