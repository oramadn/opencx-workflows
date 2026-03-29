-- Messages for two-way prototype chat (customer vs agent) per session
CREATE TABLE session_messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    author_role VARCHAR(50) NOT NULL, -- 'customer' | 'agent'
    body TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_session_messages_session_created ON session_messages(session_id, created_at);

CREATE OR REPLACE FUNCTION bump_session_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE sessions SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.session_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_session_messages_bump_session
    AFTER INSERT ON session_messages
    FOR EACH ROW
    EXECUTE PROCEDURE bump_session_updated_at();
